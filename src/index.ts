import { parse as parseSvelteTemplate } from "svelte/compiler";
import { ts } from "./ts";
import type { Ast, Attribute, BaseNode, Fragment } from "svelte/types/compiler/interfaces";
import type { Expression } from "estree";
import { generate as estreeToCode } from "astring";
import prettier from "prettier";

// from svelte source: https://github.com/sveltejs/svelte/blob/master/packages/svelte/src/compiler/preprocess/index.js#L255-L256
const regex_style_tags = /<!--[^]*?-->|<style(\s[^]*?)?(?:>([^]*?)<\/style>|\/>)/gi;
const regex_script_tags = /<!--[^]*?-->|<script(\s[^]*?)?(?:>([^]*?)<\/script>|\/>)/gi;

type Preparsed = {
  html: string;
  styleTags: string[];
  scriptTags: string[];
};

export function preparse(code: string): Preparsed {
  const styleTags: string[] = [];
  const scriptTags: string[] = [];
  const html = code
    .replace(regex_style_tags, (_, __, style) => {
      styleTags.push(style ?? "");
      return "";
    })
    .replace(regex_script_tags, (_, __, script) => {
      scriptTags.push(script ?? "");
      return "";
    });
  return {
    html,
    styleTags,
    scriptTags,
  };
}

export function svelteToReact(preparsed: Preparsed) {
  const parsedTemplate = parseSvelteTemplate(preparsed.html);
  const out = templateToTsx(parsedTemplate.html as Fragment);

  // TODO: support multiple script tags
  const {
    toplevel: module,
    instance,
    propsTypeLiteral: propsType,
    propsInitializer,
  } = instanceToTs(preparsed.scriptTags[0]);
  const componentFunc = ts.factory.createExportDefault(
    ts.factory.createArrowFunction(
      undefined,
      undefined,
      [
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          propsInitializer,
          undefined,
          // undefined,
          propsType,
          // initializer
          undefined,
        ),
      ],
      undefined,
      undefined,
      ts.factory.createBlock([...instance, ts.factory.createReturnStatement(out as ts.Expression)]),
    ),
  );

  const file = ts.factory.createSourceFile(
    [...module, componentFunc],
    ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
    ts.NodeFlags.None,
  );

  const printer = ts.createPrinter();
  const outCode = printer.printFile(file);
  return outCode;
}

// type ConvertableFeatures = "onMount";
// const convertableFeatures: ConvertableFeatures[] = ["onMount"];

type ConvertContext = {
  mutables: Set<string>;
  reactFeatures: Set<string>;
};
const createSvelteTransformer: (cctx: ConvertContext) => { transformer: ts.TransformerFactory<any> } = (cctx) => {
  return {
    transformer: (context) => {
      // const mutableVars = new Set<string>();
      return (root) => {
        const visit: ts.Visitor = (node) => {
          if (ts.isVariableStatement(node)) {
            const isConst = node.declarationList.flags & ts.NodeFlags.Const;
            if (isConst) {
              // TODO: transform righthand
              return ts.visitEachChild(node, visit, context);
              // return node;
            }
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

function instanceToTs(input: string): {
  instance: ts.Statement[];
  toplevel: ts.Statement[];
  propsTypeLiteral: ts.TypeLiteralNode;
  propsInitializer: ts.ObjectBindingPattern;
} {
  const inputFile = ts.createSourceFile("input.tsx", input, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  // TODO: hoist imports and exports
  // TODO: handle computed props

  const instance: ts.Statement[] = [];
  const memberDeclarations: Array<ts.VariableDeclaration> = [];
  const toplevel: ts.Statement[] = [];
  const instanceStmts: ts.Statement[] = [];

  const cctx: ConvertContext = {
    mutables: new Set<string>(),
    reactFeatures: new Set<string>(),
  };

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
              memberDeclarations.push(decl);
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
      toplevel.push(stmt);
      continue;
    } else if (ts.isExportDeclaration(stmt)) {
      toplevel.push(stmt);
      continue;
    } else {
      instanceStmts.push(stmt);
    }
  }

  // TODO: check props is rewroted by body
  // const touchedProps = new Set<string>();
  // batch transform
  const instanceBody = ts.factory.createBlock(instanceStmts);

  const { transformer } = createSvelteTransformer(cctx);
  const transformedStmts = ts.transform(instanceBody, [transformer]).transformed[0] as ts.Block;
  instance.push(...transformedStmts.statements);

  // convert prop decls to type literal
  const propsTypeLiteral = ts.factory.createTypeLiteralNode(
    memberDeclarations.map((prop) => {
      const name = prop.name as ts.Identifier;
      const type = prop.type ?? ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
      const questionToken = prop.initializer != null ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined;
      return ts.factory.createPropertySignature(undefined, name, questionToken, type);
    }),
  );

  const propsInitializer = ts.factory.createObjectBindingPattern(
    memberDeclarations.map((prop) => {
      return ts.factory.createBindingElement(undefined, undefined, prop.name as ts.Identifier, prop.initializer);
    }),
  );

  const reactImports = ts.factory.createImportDeclaration(
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
  toplevel.unshift(reactImports);
  // TODO: transform instance body
  return {
    instance,
    toplevel,
    propsTypeLiteral,
    propsInitializer,
  };
}

function expressionToTsExpression(expr: Expression) {
  const exprCode = estreeToCode(expr);
  const file = ts.createSourceFile("expr.tsx", exprCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const tsExpr = file.statements[0] as ts.ExpressionStatement;
  if (tsExpr == null) {
    throw new Error("Failed to parse expression: " + exprCode);
  }
  return tsExpr.expression;
}

function templateToTsx(root: Fragment) {
  return _templateToTsx(root, true, 0);
}

const attrConvertMap: { [key: string]: string } = {
  class: "className",
};

const eventConvertMap: { [key: string]: string } = {
  click: "onClick",
};

function _templateToTsx(node: BaseNode, isElementChildren: boolean, depth = 0): ts.Node {
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
      const expr = expressionToTsExpression(node.expression);
      return ts.factory.createJsxExpression(undefined, expr);
    }
    case "IfBlock": {
      const expr = expressionToTsExpression(node.expression) as ts.Expression;
      const children = (node.children ?? []).map((child) => _templateToTsx(child, true, depth + 1));
      const elseBlock = node.else
        ? (_templateToTsx(node.else, true, depth + 1) as ts.Expression)
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
      const children = (node.children ?? []).map((child) => _templateToTsx(child, true, depth + 1));
      return ts.factory.createJsxFragment(
        ts.factory.createJsxOpeningFragment(),
        children as ts.JsxChild[],
        ts.factory.createJsxJsxClosingFragment(),
      );
    }

    case "EachBlock": {
      console.log("each", node);
      const expr = expressionToTsExpression(node.expression) as ts.Expression;
      const children = (node.children ?? []).map((child) => _templateToTsx(child, true, depth + 1));
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
      // ts.factory.createJsxOpeningFragment(),
      // ts.factory.createCallExpression(ts.factory.createIdentifier("React.Fragment"), undefined, [
    }

    case "EventHandler": {
      const expr = expressionToTsExpression(node.expression);
      const name = node.name;
      const eventName = eventConvertMap[name] ?? name;
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
      const right = _templateToTsx(value, false, depth + 1) as ts.JsxAttributeValue;
      const attrName = attrConvertMap[name] ?? name;
      return ts.factory.createJsxAttribute(ts.factory.createIdentifier(attrName), right);
    }
    case "Element": {
      // TODO: handle component tag
      const tagName = node.name as string;

      const attributes = node.attributes.map((attr: Attribute) => {
        return _templateToTsx(attr, false, depth + 1);
      });

      const children = (node.children ?? []).map((child) => _templateToTsx(child, true, depth + 1));
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
          const expr = _templateToTsx(child as BaseNode, true, depth + 1);
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

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test("parse", () => {
    const code = `
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
    const parsed = preparse(code);
    // console.log(parsed.html);
    expect(parsed.styleTags.length).toBe(1);
    expect(parsed.scriptTags.length).toBe(1);
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
    const preparsed = preparse(code);
    const result = svelteToReact(preparsed);
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
}
