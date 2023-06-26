import { parse as parseSvelteTemplate } from "svelte/compiler";
import { ts } from "./ts";
import type { Ast, Attribute, BaseNode, Fragment } from "svelte/types/compiler/interfaces";
import type { Expression } from "estree";
import { generate as estreeToCode } from "astring";
import prettier from "prettier";

export function svelteToReact(code: string) {
  const parsed = parseSvelteTemplate(code);
  const out = templateToTsx(parsed.html as Fragment);

  const { toplevel: module, instance, propsType } = instanceToTs(parsed);
  const componentFunc = ts.factory.createExportDefault(
    ts.factory.createArrowFunction(
      undefined,
      undefined,
      [
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          "props",
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

type ConvertableFeatures = "onMount";
const convertableFeatures: ConvertableFeatures[] = ["onMount"];

function instanceToTs(parsed: Ast): {
  instance: ts.Statement[];
  toplevel: ts.Statement[];
  propsType: ts.TypeLiteralNode;
} {
  const inputCode = estreeToCode(parsed.instance!.content);
  const inputFile = ts.createSourceFile("input.tsx", inputCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  // TODO: hoist imports and exports
  // TODO: extract props from export let/const
  // TODO: handle computed props

  const instance: ts.Statement[] = [];
  const memberDeclarations: Array<ts.VariableDeclaration> = [];
  const toplevel: ts.Statement[] = [];
  const usingReactFeatures = new Set<string>();

  const mutableVars = new Set<string>();
  const instanceStmts: ts.Statement[] = [];

  // one step toplevel analyze
  for (const stmt of inputFile.statements) {
    // handle top level value declaration
    if (ts.isVariableStatement(stmt)) {
      const isPropsMember = stmt.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const isLetDecl = stmt.declarationList.flags & ts.NodeFlags.Let;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          if (isLetDecl) {
            mutableVars.add(decl.name.text);
            usingReactFeatures.add("useState");
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
                usingReactFeatures.add("useEffect");
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
  const touchedProps = new Set<string>();
  const transformerFactory: ts.TransformerFactory<any> = (context) => {
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
              if (mutableVars.has(decl.name.text)) {
                // mark is mutable to provide onProps
                touchedProps.add(decl.name.text);
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
            if (mutableVars.has(node.left.text)) {
              return ts.factory.createCallExpression(ts.factory.createIdentifier(`set$${node.left.text}`), undefined, [
                node.right,
              ]);
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
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitEachChild(root, visit, context);
    };
  };

  // batch transform
  const instanceBody = ts.factory.createBlock(instanceStmts);
  const transformedStmts = ts.transform(instanceBody, [transformerFactory]).transformed[0] as ts.Block;
  instance.push(...transformedStmts.statements);

  // convert prop decls to type literal
  const propsType = ts.factory.createTypeLiteralNode(
    memberDeclarations.map((prop) => {
      const name = prop.name as ts.Identifier;
      const type = prop.initializer ? ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword) : undefined;
      return ts.factory.createPropertySignature(undefined, name, undefined, type);
    }),
  );

  const reactImports = ts.factory.createImportDeclaration(
    undefined,
    // undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamedImports(
        [...usingReactFeatures].map((feature) => {
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
    propsType,
    toplevel,
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
  return _templateToTsx(root);
}

function _templateToTsx(node: BaseNode, depth = 0): ts.Node {
  console.log("  ".repeat(depth) + `[${node.type}]`, node.children?.length ?? 0);
  switch (node.type) {
    case "Text": {
      return ts.factory.createJsxText(node.data);
    }
    case "MustacheTag": {
      const expr = expressionToTsExpression(node.expression);
      return ts.factory.createJsxExpression(undefined, expr);
    }

    // case "EventHandler": {
    //   const expr = expressionToTsExpression(node.expression);
    //   const name = node.name;
    //   return ts.factory.createJsxAttribute(
    //     ts.factory.createIdentifier(name),
    //     ts.factory.createJsxExpression(undefined, expr),
    //   );
    // }
    case "Element": {
      // TODO: handle component tag
      const tagName = node.name as string;
      const children = (node.children ?? []).map((child) => _templateToTsx(child, depth + 1));

      // TODO: recursive
      const attributes = node.attributes.map((attr: Attribute) => {
        if (attr.type === "Attribute") {
          const name = attr.name;
          // TODO: handle array
          const value = attr.value[0] ?? "";
          return ts.factory.createJsxAttribute(
            ts.factory.createIdentifier(name),
            ts.factory.createStringLiteral(value),
          );
        } else if (attr.type === "AttributeShorthand") {
          const name = attr.name;
          return ts.factory.createJsxAttribute(
            ts.factory.createIdentifier(name),
            ts.factory.createJsxExpression(undefined, ts.factory.createIdentifier(name)),
          );
        } else if (attr.type === "AttributeSpread") {
          const expr = expressionToTsExpression(attr.expression);
          return ts.factory.createJsxSpreadAttribute(expr);
        } else if (attr.type === "EventHandler") {
          const expr = expressionToTsExpression(attr.expression);
          const name = attr.name;
          const eventConvertMap: { [key: string]: string } = {
            click: "onClick",
          };
          const eventName = eventConvertMap[name] ?? name;
          return ts.factory.createJsxAttribute(
            ts.factory.createIdentifier(eventName),
            ts.factory.createJsxExpression(undefined, expr),
          );
        } else {
          throw new Error("Unknown attribute type: " + attr.type);
        }
      });
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
          const expr = _templateToTsx(child as BaseNode, depth + 1);
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
  test("test", () => {
    const code = `
    <script>
      import { onMount } from "svelte";
      export let foo;
      // export let bar = 1; // with initializer

      const x = 1;
      let mut = 2;
      onMount(() => {
        console.log("mounted");
        mut = 4;
      });

      const onClick = () => {
        console.log("clicked");
        mut = mut + 1;
      }
    </script>
    <div>hello, {x}</div>
    <button on:click={onClick}>click</button>
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
    expect(formatted).toContain("useEffect(() => {");
    expect(formatted).toContain("const [mut, set$mut] = useState(2);");
    expect(formatted).toContain("export default (");
    expect(formatted).toContain("set$mut(4);");
    expect(formatted).toContain("<button onClick={onClick}");
  });
}
