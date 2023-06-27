import { parse as parseSvelte } from "svelte/compiler";
import { ts } from "./ts";
import type { Ast, Attribute, BaseNode, Fragment } from "svelte/types/compiler/interfaces";
import type { Expression } from "estree";
import { generate as estreeToCode } from "astring";
import prettier from "prettier";

// Constants
const ATTRIBUTES_CONVERT_MAP: { [key: string]: string } = {
  class: "className",
};

const EVENTS_CONVERT_MAP: { [key: string]: string } = {
  click: "onClick",
};

// from svelte source: https://github.com/sveltejs/svelte/blob/master/packages/svelte/src/compiler/preprocess/index.js#L255-L256
const REGEX_STYLE_TAGS = /<!--[^]*?-->|<style(\s[^]*?)?(?:>([^]*?)<\/style>|\/>)/gi;
const REGEX_SCRIPT_TAGS = /<!--[^]*?-->|<script(\s[^]*?)?(?:>([^]*?)<\/script>|\/>)/gi;

/** @internal */
type Parsed = {
  html: string;
  styleTags: string[];
  scriptTags: Array<{ lang?: string; module: boolean; code: string }>;
};

/** @internal */
type ParsedComponentSignature = {
  propsTypeLiteral: ts.TypeLiteralNode;
  propsInitializer: ts.ObjectBindingPattern;
};

/** @internal */
type ParsedStyle = {
  classAliasMap: Map<string, string>;
};

/** @internal */
type ConvertContext = {
  toplevel: ts.Statement[];
  instance: ts.Statement[];
  mutables: Set<string>;
  reactFeatures: Set<string>;
};

export function svelteToReact(code: string) {
  const parsed = parse(code);

  const cctx: ConvertContext = {
    toplevel: [],
    instance: [],
    mutables: new Set<string>(),
    reactFeatures: new Set<string>(),
  };
  const codeBlock = buildCodeBlock(parsed.scriptTags, cctx);

  // consume style tags
  buildStyleBlock(parsed.styleTags, cctx);
  const templateBlock = buildTemplate(parsed.html, codeBlock, cctx);
  const file = buildFile(templateBlock, cctx);
  const printer = ts.createPrinter();
  const outCode = printer.printFile(file);
  return outCode;
}

export function parse(code: string): Parsed {
  const styleTags: string[] = [];
  const scriptTags: Array<{ lang?: string; module: boolean; code: string }> = [];
  const html = code
    .replace(REGEX_STYLE_TAGS, (_, __, style: string) => {
      styleTags.push(style ?? "");
      return "";
    })
    .replace(REGEX_SCRIPT_TAGS, (_, attributes: string, script: string) => {
      // console.log("[script tag]", attributes);
      scriptTags.push({
        module: /context=['"]?module['"]?/.test(attributes ?? "") ?? false,
        code: script ?? "",
      });
      return "";
    });
  return {
    html,
    styleTags,
    scriptTags,
  };
}

function buildStyleBlock(styleTags: string[], cctx: ConvertContext): ParsedStyle {
  // TODO: collect scoped css alias
  const classNames = new Map<string, string>();
  return {
    classAliasMap: classNames,
  };
}

/** Convert svelte fragment to function component */
function buildTemplate(template: string, signature: ParsedComponentSignature, cctx: ConvertContext): ts.Statement[] {
  const parsedTemplate = parseSvelte(template);
  const tsx = templateToTsx(parsedTemplate.html as Fragment);
  return [
    ts.factory.createExportDefault(
      ts.factory.createArrowFunction(
        undefined,
        undefined,
        [
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            signature.propsInitializer,
            undefined,
            // undefined,
            signature.propsTypeLiteral,
            // initializer
            undefined,
          ),
        ],
        undefined,
        undefined,
        ts.factory.createBlock([...cctx.instance, ts.factory.createReturnStatement(tsx as ts.Expression)]),
      ),
    ),
  ];
}

// TypeScript transformer for svelte
const createSvelteTransformer: (cctx: ConvertContext) => { transformer: ts.TransformerFactory<any> } = (cctx) => {
  return {
    transformer: (context) => {
      return (root) => {
        const visit: ts.Visitor = (node) => {
          if (ts.isVariableStatement(node)) {
            const isConst = node.declarationList.flags & ts.NodeFlags.Const;
            if (isConst) {
              return ts.visitEachChild(node, visit, context);
            }

            // transform as let assignment
            const newStmts: ts.Statement[] = [];
            // const isLet = node.declarationList.flags & ts.NodeFlags.Let;
            for (const decl of node.declarationList.declarations) {
              const isExport = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
              if (isExport) {
                continue;
              }
              if (ts.isIdentifier(decl.name)) {
                if (cctx.mutables.has(decl.name.text)) {
                  // mark is mutable to provide onProps
                  // touchedProps.add(decl.name.text);
                  const newDecl = ts.factory.createVariableStatement(
                    undefined,
                    ts.factory.createVariableDeclarationList(
                      [
                        ts.factory.createVariableDeclaration(
                          ts.factory.createArrayBindingPattern([
                            ts.factory.createBindingElement(undefined, undefined, decl.name),
                            ts.factory.createBindingElement(
                              undefined,
                              undefined,
                              ts.factory.createIdentifier(`set$${decl.name.text}`),
                            ),
                          ]),
                          undefined,
                          undefined,
                          ts.factory.createCallExpression(ts.factory.createIdentifier("useState"), undefined, [
                            decl.initializer ?? ts.factory.createNull(),
                          ]),
                        ),
                      ],
                      ts.NodeFlags.Const,
                    ),
                  );
                  newStmts.push(newDecl);
                }
              }
            }
            return newStmts;
          }
          // let foo; foo = 1 => ((tmp = 1 || true) && set$foo(tmp) && tmp);
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            // Only support direct ExpressionStatement assign like `foo = 1`
            if (node.parent && !ts.isExpressionStatement(node.parent)) {
              throw new Error(`Not Supported: intermediate let value assignment`);
            }
            if (ts.isIdentifier(node.left)) {
              if (cctx.mutables.has(node.left.text)) {
                return ts.factory.createCallExpression(
                  ts.factory.createIdentifier(`set$${node.left.text}`),
                  undefined,
                  [node.right],
                );
              }
            }
          }

          // onMount => useEffect()
          if (ts.isCallExpression(node)) {
            if (ts.isIdentifier(node.expression) && node.expression.text === "onMount") {
              const arrowFunc = node.arguments[0] as ts.ArrowFunction;
              const body = arrowFunc.body as ts.Block;
              const newCallback = ts.factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                undefined,
                ts.factory.createBlock(
                  body.statements.map((stmt) => {
                    return visit(stmt);
                  }) as ts.Statement[],
                ),
              );
              return ts.factory.createCallExpression(ts.factory.createIdentifier("useEffect"), undefined, [
                newCallback,
                ts.factory.createArrayLiteralExpression([]),
              ]);
            }
            // onDestroy => useEffect()
            if (ts.isIdentifier(node.expression) && node.expression.text === "onDestroy") {
              const arrowFunc = node.arguments[0] as ts.ArrowFunction;
              const body = arrowFunc.body as ts.Block;
              const newCallback = ts.factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                undefined,
                ts.factory.createBlock(
                  body.statements.map((stmt) => {
                    return visit(stmt);
                  }) as ts.Statement[],
                ),
              );
              return ts.factory.createCallExpression(
                ts.factory.createIdentifier("useEffect"),
                undefined,
                // undefined,
                [
                  ts.factory.createArrowFunction(
                    undefined,
                    undefined,
                    [],
                    undefined,
                    undefined,
                    ts.factory.createBlock([ts.factory.createReturnStatement(newCallback)]),
                  ),
                ],
              );
            }
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitEachChild(root, visit, context);
      };
    },
  };
};

/** Convert script tags to toplevel and instance statements  */
function buildCodeBlock(scriptTags: Parsed["scriptTags"], cctx: ConvertContext): ParsedComponentSignature {
  if (scriptTags.length > 2) {
    throw new Error("Not supported: script tag only allows 2 blocks including default and module");
  }
  const moduleBlock = scriptTags.find((tag) => tag.module);
  const defaultBlock = scriptTags.find((tag) => !tag.module);
  return _buildCodeBlockWorker(cctx, moduleBlock?.code, defaultBlock?.code);
}

function _buildCodeBlockWorker(
  cctx: ConvertContext,
  moduleCode: string = "",
  defaultCode: string = "",
): ParsedComponentSignature {
  const propMembers: Array<ts.VariableDeclaration> = [];

  // const instance: ts.Statement[] = [];
  // const toplevel: ts.Statement[] = [];
  const instanceStmts: ts.Statement[] = [];

  // include module code to toplevel
  if (moduleCode !== "") {
    const moduleFile = ts.createSourceFile("_module.tsx", moduleCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    for (const stmt of moduleFile.statements) {
      cctx.toplevel.push(stmt);
    }
  }

  const inputFile = ts.createSourceFile("_input.tsx", defaultCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  // TODO: handle computed props

  // one step toplevel analyze
  for (const stmt of inputFile.statements) {
    // handle top level value declaration
    if (ts.isVariableStatement(stmt)) {
      const isPropsMember = stmt.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const isLetDecl = stmt.declarationList.flags & ts.NodeFlags.Let;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          if (isLetDecl) {
            cctx.mutables.add(decl.name.text);
            cctx.reactFeatures.add("useState");
            if (isPropsMember) {
              propMembers.push(decl);
            }
          }
          instanceStmts.push(stmt);
        }
      }
    }
    // handle import ... from "svelte"
    else if (ts.isImportDeclaration(stmt)) {
      if (ts.isStringLiteral(stmt.moduleSpecifier) && stmt.moduleSpecifier.text === "svelte") {
        // convert svelte import
        if (stmt.importClause?.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const specifier of stmt.importClause.namedBindings.elements) {
            if (ts.isImportSpecifier(specifier) && ts.isIdentifier(specifier.name)) {
              if (specifier.name.text === "onMount") {
                cctx.reactFeatures.add("useEffect");
              }
            }
          }
        }
        continue;
      }
      cctx.toplevel.push(stmt);
      continue;
    } else if (ts.isExportDeclaration(stmt)) {
      cctx.toplevel.push(stmt);
      continue;
    } else {
      instanceStmts.push(stmt);
    }
  }

  // TODO: check props is rewroted by body
  // const touchedProps = new Set<string>();
  const instanceBody = ts.factory.createBlock(instanceStmts);

  const { transformer } = createSvelteTransformer(cctx);
  const transformedStmts = ts.transform(instanceBody, [transformer]).transformed[0] as ts.Block;
  cctx.instance.push(...transformedStmts.statements);

  // convert prop decls to type literal
  const propsTypeLiteral = ts.factory.createTypeLiteralNode(
    propMembers.map((prop) => {
      const name = prop.name as ts.Identifier;
      const type = prop.type ?? ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
      const questionToken = prop.initializer != null ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined;
      return ts.factory.createPropertySignature(undefined, name, questionToken, type);
    }),
  );

  const propsInitializer = ts.factory.createObjectBindingPattern(
    propMembers.map((prop) => {
      return ts.factory.createBindingElement(undefined, undefined, prop.name as ts.Identifier, prop.initializer);
    }),
  );

  // TODO: transform instance body
  return {
    propsTypeLiteral,
    propsInitializer,
  };
}

function estreeExprToTsExpr(expr: Expression) {
  const exprCode = estreeToCode(expr);
  const file = ts.createSourceFile("expr.tsx", exprCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const tsExpr = file.statements[0] as ts.ExpressionStatement;
  if (tsExpr == null) {
    throw new Error("Failed to parse expression: " + exprCode);
  }
  return tsExpr.expression;
}

function templateToTsx(root: Fragment) {
  return _buildTemplate(root, true, 0);
}

function _buildTemplate(node: BaseNode, isElementChildren: boolean, depth = 0): ts.Node {
  console.log("  ".repeat(depth) + `[${node.type}]`, node.children?.length ?? 0);
  switch (node.type) {
    case "Text": {
      if (isElementChildren) {
        return ts.factory.createJsxText(node.data);
      } else {
        return ts.factory.createStringLiteral(node.data);
      }
    }
    case "MustacheTag": {
      const expr = estreeExprToTsExpr(node.expression);
      return ts.factory.createJsxExpression(undefined, expr);
    }
    case "IfBlock": {
      const expr = estreeExprToTsExpr(node.expression) as ts.Expression;
      const children = (node.children ?? []).map((child) => _buildTemplate(child, true, depth + 1));
      const elseBlock = node.else
        ? (_buildTemplate(node.else, true, depth + 1) as ts.Expression)
        : ts.factory.createIdentifier("undefined");
      return ts.factory.createJsxExpression(
        undefined,
        ts.factory.createConditionalExpression(
          expr,
          undefined,
          ts.factory.createJsxFragment(
            ts.factory.createJsxOpeningFragment(),
            children as ts.JsxChild[],
            ts.factory.createJsxJsxClosingFragment(),
          ),
          undefined,
          elseBlock,
        ),
      );
    }
    case "ElseBlock": {
      const children = (node.children ?? []).map((child) => _buildTemplate(child, true, depth + 1));
      return ts.factory.createJsxFragment(
        ts.factory.createJsxOpeningFragment(),
        children as ts.JsxChild[],
        ts.factory.createJsxJsxClosingFragment(),
      );
    }

    case "EachBlock": {
      console.log("each", node);
      const expr = estreeExprToTsExpr(node.expression) as ts.Expression;
      const children = (node.children ?? []).map((child) => _buildTemplate(child, true, depth + 1));
      // TODO: handle as expr
      const key = ts.factory.createIdentifier(node.context.name);
      return ts.factory.createJsxExpression(
        undefined,
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(expr, ts.factory.createIdentifier("map")),
          undefined,
          [
            ts.factory.createArrowFunction(
              undefined,
              undefined,
              [
                ts.factory.createParameterDeclaration(undefined, undefined, key, undefined, undefined, undefined),
                ...(node.index != null
                  ? [
                      ts.factory.createParameterDeclaration(
                        undefined,
                        undefined,
                        // TODO: handle as expr
                        ts.factory.createIdentifier(node.index),
                        undefined,
                        undefined,
                        undefined,
                      ),
                    ]
                  : []),
              ],
              undefined,
              undefined,
              ts.factory.createJsxFragment(
                ts.factory.createJsxOpeningFragment(),
                children as ts.JsxChild[],
                ts.factory.createJsxJsxClosingFragment(),
              ),
            ),
          ],
        ),
      );
    }

    case "EventHandler": {
      const expr = estreeExprToTsExpr(node.expression);
      const name = node.name;
      const eventName = EVENTS_CONVERT_MAP[name] ?? name;
      return ts.factory.createJsxAttribute(
        ts.factory.createIdentifier(eventName),
        ts.factory.createJsxExpression(undefined, expr),
      );
    }
    case "AttributeShorthand": {
      throw new Error("WIP");
    }
    case "AttributeSpread": {
      throw new Error("WIP");
    }
    case "Attribute": {
      const name = node.name;
      // TODO: handle array
      const value = node.value[0] ?? "";
      const right = _buildTemplate(value, false, depth + 1) as ts.JsxAttributeValue;
      const attrName = ATTRIBUTES_CONVERT_MAP[name] ?? name;
      return ts.factory.createJsxAttribute(ts.factory.createIdentifier(attrName), right);
    }
    case "Element": {
      // TODO: handle component tag
      const tagName = node.name as string;

      const attributes = node.attributes.map((attr: Attribute) => {
        return _buildTemplate(attr, false, depth + 1);
      });

      const children = (node.children ?? []).map((child) => _buildTemplate(child, true, depth + 1));
      return ts.factory.createJsxElement(
        ts.factory.createJsxOpeningElement(
          ts.factory.createIdentifier(tagName),
          undefined,
          ts.factory.createJsxAttributes(attributes),
        ),
        children as ts.JsxChild[],
        ts.factory.createJsxClosingElement(ts.factory.createIdentifier(tagName)),
      );
    }
    case "Fragment": {
      const contents: ts.JsxElement[] = [];
      if (node.children && node.children.length > 0) {
        // TODO: Handle template tag
        // return root.children.map((child) => htmlToTsx(child as BaseNode, depth + 1));
        for (const child of node.children) {
          const expr = _buildTemplate(child as BaseNode, true, depth + 1);
          contents.push(expr as ts.JsxElement);
        }
      }
      return ts.factory.createJsxFragment(
        ts.factory.createJsxOpeningFragment(),
        contents as ReadonlyArray<ts.JsxChild>,
        ts.factory.createJsxJsxClosingFragment(),
      );
    }
    default: {
      throw new Error("Unknown node type: " + node.type);
    }
  }
}

function buildFile(template: ts.Statement[], cctx: ConvertContext): ts.SourceFile {
  const reactImportDeclaration = ts.factory.createImportDeclaration(
    undefined,
    // undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports(
        [...cctx.reactFeatures].map((feature) => {
          return ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(feature));
        }),
      ),
    ),
    ts.factory.createStringLiteral("react"),
  );
  return ts.factory.createSourceFile(
    [reactImportDeclaration, ...cctx.toplevel, ...template],
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None,
  );
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test("parse", () => {
    const code = `
    <script lang="ts" context="module">
      export const exported = 1;
    </script>

    <script lang="ts">
      import { onMount } from "svelte";
      export let foo: number;
    </script>
    <div id="x">
      <h1>Nest</h1>
      hello, {x}
    </div>
    <style>
      div {
        color: red;
      }
    </style>
`;
    const parsed = parse(code);
    // console.log(parsed.html);
    expect(parsed.styleTags.length).toBe(1);
    expect(parsed.scriptTags.length).toBe(2);
    expect(parsed.scriptTags.filter((script) => script.module).length).toBe(1);
    expect(parsed.scriptTags.filter((script) => !script.module).length).toBe(1);
  });

  test("test", () => {
    const code = `
    <script lang="ts">
      import { onMount, onDestroy } from "svelte";
      export let foo: number;
      export let bar: number = 1;
      const x: number = 1;
      let mut = 2;
      onMount(() => {
        console.log("mounted");
        mut = 4;
      });
      onDestroy(() => {
        console.log("unmount");
      });
      const onClick = () => {
        console.log("clicked");
        mut = mut + 1;
      }

      const className = "cls";
    </script>
    <div id="x" class={className}>
      <h1>Nest</h1>
      hello, {x}
    </div>
    {#if true}
      <div>if-true</div>
    {:else if false}
      else if block
    {:else}
      else block
    {/if}
    {#each [1] as num}
      <span> {num} </span>
    {/each}
    {#each [1, 2, 3] as num, i}
      <span>{num}:{i}</span>
    {/each}
    <button on:click={onClick}>click</button>
    <style>
      div {
        color: red;
      }
    </style>
`;
    // const preparsed = preparse(code);
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    console.log("-------------");
    console.log(formatted);
    expect(formatted).toContain("{ foo, bar = 1 }");
    expect(formatted).toContain("foo: number");

    expect(formatted).toContain("useEffect(() => {");
    expect(formatted).toContain("const [mut, set$mut] = useState(2);");
    expect(formatted).toContain("export default (");
    expect(formatted).toContain("set$mut(4);");
    expect(formatted).toContain("<button onClick={onClick}");
    expect(formatted).toContain("className={className}");
    expect(formatted).toContain("[1, 2, 3].map((num, i) => (");
    expect(formatted).toContain("{true ? (");
    expect(formatted).toContain(") : (");
    expect(formatted).toContain("if-true");
    expect(formatted).toContain("<>else if block</>");
    expect(formatted).toContain(": <>else block</>");
  });

  test("with module", () => {
    const code = `
    <script lang="ts" context="module">
      export const exported: number = 1;
    </script>
    <script lang="ts">
      let v = 1;
    </script>
    <div></div>
    <style>
      div {
        color: red;
      }
    </style>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    console.log("-------------");
    console.log(formatted);
    expect(formatted).toContain("export const exported: number = 1;");
    // expect(formatted).toContain("{ foo, bar = 1 }");
    // expect(formatted).toContain("foo: number");

    // expect(formatted).toContain("useEffect(() => {");
    // expect(formatted).toContain("const [mut, set$mut] = useState(2);");
    // expect(formatted).toContain("export default (");
    // expect(formatted).toContain("set$mut(4);");
    // expect(formatted).toContain("<button onClick={onClick}");
    // expect(formatted).toContain("className={className}");
    // expect(formatted).toContain("[1, 2, 3].map((num, i) => (");
    // expect(formatted).toContain("{true ? (");
    // expect(formatted).toContain(") : (");
    // expect(formatted).toContain("if-true");
    // expect(formatted).toContain("<>else if block</>");
    // expect(formatted).toContain(": <>else block</>");
  });
}
