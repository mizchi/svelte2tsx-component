import { parse as parseSvelte } from "svelte/compiler";
import { ts } from "./ts";
import type { Ast, Attribute, BaseNode, Fragment } from "svelte/types/compiler/interfaces";
import type { Expression, Identifier } from "estree";
import { generate as estreeToCode } from "astring";
import prettier from "prettier";
import { getReactEventName, getReactEventNameFromHandlerName } from "./eventMap";
import { getReactAttributeName } from "./attributeMap";
import { buildCss } from "./css";

// Constants
// const ATTRIBUTES_CONVERT_MAP: { [key: string]: string } = {
//   class: "className",
// };

// const EVENTS_CONVERT_MAP: { [key: string]: string } = {
//   click: "onClick",
// };

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
  aliasMap: Map<string, string>;
  statements: ts.Statement[];
};

/** @internal */
type ConvertContext = {
  hasSelf: boolean;
  // slotNames: Set<string>;
  hasDefaultSlot: boolean;
  dispatcherNames: Set<string>;
  eventMap: Map<string, ts.TypeLiteralNode>;
  toplevel: ts.Statement[];
  instance: ts.Statement[];
  mutables: Set<string>;
  reactFeatures: Set<string>;
};

export function svelteToReact(code: string) {
  const parsed = parse(code);

  const cctx: ConvertContext = {
    hasSelf: false,
    hasDefaultSlot: false,
    dispatcherNames: new Set<string>(),
    eventMap: new Map<string, ts.TypeLiteralNode>(),
    toplevel: [],
    instance: [],
    mutables: new Set<string>(),
    reactFeatures: new Set<string>(),
  };
  const codeBlock = buildCodeBlock(parsed.scriptTags, cctx);

  // consume style tags
  const parsedCss = buildCss(parsed.styleTags.join("\n"));
  const templateBlock = buildTemplate(parsed.html, codeBlock, parsedCss.aliasMap, cctx);
  const file = buildFile(templateBlock, parsedCss, cctx);
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

// function buildStyleBlock(styleTags: string[], cctx: ConvertContext): ParsedStyle {
//   // TODO: collect scoped css alias
//   const classNames = new Map<string, string>();
//   const { statements, aliasMap } = buildCss(styleTags.join("\n"));
//   return {
//     aliasMap: classNames,

//   };
// }

/** Convert svelte fragment to function component */
function buildTemplate(
  template: string,
  signature: ParsedComponentSignature,
  aliasMap: Map<string, string>,
  cctx: ConvertContext,
): ts.Statement[] {
  const parsedTemplate = parseSvelte(template);
  const tsxExpr = templateToTsx(parsedTemplate.html as Fragment, aliasMap, cctx);

  // const typeLiteral
  // if (cctx.hasDefaultSlot) {
  //   signature.propsInitializer.elements.push(

  //   )
  // cctx.reactFeatures.add("Fragment");

  // const defaultSlot = ts.factory.createJsxElement(
  //   ts.factory.createJsxOpeningElement(ts.factory.createIdentifier("Fragment")),
  //   [
  //     ts.factory.createJsxExpression(
  //       undefined,
  //       ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("props"), "children"),
  //     ),
  //   ],
  //   ts.factory.createJsxClosingElement(ts.factory.createIdentifier("Fragment")),
  // );
  // cctx.instance.push(
  //   ts.factory.createVariableStatement(
  //     undefined,
  //     ts.factory.createVariableDeclarationList(
  //       [
  //         ts.factory.createVariableDeclaration(
  //           ts.factory.createIdentifier("defaultSlot"),
  //           undefined,
  //           undefined,
  //           defaultSlot,
  //         ),
  //       ],
  //       ts.NodeFlags.Const,
  //     ),
  //   ),
  // );
  // }

  if (cctx.hasDefaultSlot) {
    cctx.reactFeatures.add("ReactNode");
  }

  const finalPropsTypeLiteral = cctx.hasDefaultSlot
    ? ts.factory.createTypeLiteralNode([
        ...signature.propsTypeLiteral.members,
        ts.factory.createPropertySignature(
          undefined,
          ts.factory.createIdentifier("children"),
          ts.factory.createToken(ts.SyntaxKind.QuestionToken),
          ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("ReactNode"), undefined),
        ),
      ])
    : signature.propsTypeLiteral;

  const finalPropsInitializer = cctx.hasDefaultSlot
    ? ts.factory.createObjectBindingPattern([
        ...signature.propsInitializer.elements,
        ts.factory.createBindingElement(undefined, undefined, ts.factory.createIdentifier("children"), undefined),
      ])
    : signature.propsInitializer;

  const hasAnyProp = finalPropsTypeLiteral.members.length > 0;
  const properties = hasAnyProp
    ? [
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          finalPropsInitializer,
          undefined,
          // undefined,
          finalPropsTypeLiteral,
          // initializer
          undefined,
        ),
      ]
    : [];

  const newBody = ts.factory.createBlock([
    ...cctx.instance,
    ts.factory.createReturnStatement(tsxExpr as ts.Expression),
  ]);

  return [
    ts.factory.createExportDefault(
      cctx.hasSelf
        ? ts.factory.createFunctionExpression(
            undefined,
            undefined,
            ts.factory.createIdentifier("Component"),
            undefined,
            properties,
            undefined,
            newBody,
          )
        : ts.factory.createArrowFunction(undefined, undefined, properties, undefined, undefined, newBody),
    ),
  ];
}

// TypeScript transformer for svelte
const createSvelteTransformer: (cctx: ConvertContext) => { transformer: ts.TransformerFactory<any> } = (cctx) => {
  return {
    transformer: (context) => {
      return (root) => {
        let localUniqueCounter = 0;
        const visit: ts.Visitor = (node) => {
          if (ts.isVariableStatement(node)) {
            // skip const
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
              // extract dispatcher type and strip
              // console.log("decl", decl.initializer);

              // let foo
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
          // Computed $: foo = val + 1 => useEffect(() => { set$foo(1)  }, [foo])
          if (ts.isLabeledStatement(node) && ts.isIdentifier(node.label) && node.label.text === "$") {
            // simple assignment to: const foo = val + 1;
            if (
              ts.isExpressionStatement(node.statement) &&
              // foo = expr
              ts.isBinaryExpression(node.statement.expression) &&
              node.statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isIdentifier(node.statement.expression.left) &&
              ts.isExpression(node.statement.expression.right)
              // TODO: check right includes mutables
            ) {
              // added const is mutable againt assigning value
              cctx.mutables.add(node.statement.expression.left.text);
              return ts.factory.createVariableStatement(
                undefined,
                ts.factory.createVariableDeclarationList(
                  [
                    ts.factory.createVariableDeclaration(
                      ts.factory.createIdentifier(node.statement.expression.left.text),
                      undefined,
                      undefined,
                      node.statement.expression.right,
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              );
            }
            // create useEffect withmemoized keys
            // TODO: handle block
            if (ts.isExpressionStatement(node.statement) || ts.isBlock(node.statement)) {
              const memoizeKeys = new Set<string>();
              const visitExpr = (node: ts.Node) => {
                if (
                  ts.isIdentifier(node) &&
                  (node.parent ? !ts.isPropertyAccessExpression(node.parent) : true) &&
                  cctx.mutables.has(node.text)
                ) {
                  memoizeKeys.add(node.text);
                }
                return ts.visitEachChild(node, visitExpr, context);
              };
              ts.visitEachChild(node.statement, visitExpr, context);

              const newBlock = ts.isBlock(node.statement) ? node.statement : ts.factory.createBlock([node.statement]);
              return ts.factory.createExpressionStatement(
                ts.factory.createCallExpression(ts.factory.createIdentifier("useEffect"), undefined, [
                  ts.factory.createArrowFunction(
                    undefined,
                    undefined,
                    [],
                    undefined,
                    undefined,
                    visit(newBlock) as ts.Block,
                  ),
                  ts.factory.createArrayLiteralExpression(
                    [...memoizeKeys].map((key) => ts.factory.createIdentifier(key)),
                  ),
                ]),
              );
            }
          }
          // TODO: Refactor to svelte api converter
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            if (cctx.dispatcherNames.has(node.expression.text)) {
              // dispatch("foo", { detail: 1 }) to onFoo({ detail: 1 })
              const firstArg = node.arguments[0];
              if (ts.isStringLiteral(firstArg)) {
                const eventName = `on${firstArg.text[0].toUpperCase()}${firstArg.text.slice(1)}`;
                return ts.factory.createCallChain(
                  ts.factory.createIdentifier(eventName),
                  ts.factory.createToken(ts.SyntaxKind.QuestionDotToken),
                  undefined,
                  node.arguments.slice(1),
                );
              } else {
                throw new Error("Not supported: dynamic event name");
              }
              // const funcName = `on${node.arguments[0].text[0].toUpperCase()}${node.arguments[0].text.slice(1)}`;
              // return ts.factory.createCallExpression(
              //   ts.factory.createIdentifier("createEventDispatcher"),
              // )
            }
            // TODO: Support aliased names
            if (node.expression.text === "onMount") {
              cctx.reactFeatures.add("useEffect");
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
            if (node.expression.text === "onDestroy") {
              cctx.reactFeatures.add("useEffect");
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
                  ts.factory.createArrayLiteralExpression([]),
                ],
              );
            }
            // beforeUpdate to useEffect
            if (node.expression.text === "beforeUpdate") {
              cctx.reactFeatures.add("useEffect");
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
                // no deps to update always
              ]);
            }
            if (node.expression.text === "afterUpdate") {
              cctx.reactFeatures.add("useRef");
              const arrowFunc = node.arguments[0] as ts.ArrowFunction;
              const body = arrowFunc.body as ts.Block;
              const refName = `_ref${localUniqueCounter++}`;

              const newCallback = ts.factory.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                undefined,
                ts.factory.createBlock([
                  // if (!_ref$1.current) { _ref$1.current = true; return; }
                  ts.factory.createIfStatement(
                    // !_ref$1.current
                    ts.factory.createPrefixUnaryExpression(
                      ts.SyntaxKind.ExclamationToken,
                      ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(refName), "current"),
                    ),
                    // { _ref$1.current = true; return; }
                    ts.factory.createBlock([
                      ts.factory.createExpressionStatement(
                        ts.factory.createBinaryExpression(
                          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier(refName), "current"),
                          ts.SyntaxKind.EqualsToken,
                          ts.factory.createTrue(),
                        ),
                      ),
                      ts.factory.createReturnStatement(),
                    ]),
                  ),
                  // rest body
                  ...(body.statements.map((stmt) => {
                    return visit(stmt);
                  }) as ts.Statement[]),
                ]),
              );
              // register: const _ref$1 = useRef(false);
              const refStatement = ts.factory.createVariableStatement(
                undefined,
                ts.factory.createVariableDeclarationList(
                  [
                    ts.factory.createVariableDeclaration(
                      ts.factory.createIdentifier(refName),
                      undefined,
                      undefined,
                      ts.factory.createCallExpression(ts.factory.createIdentifier("useRef"), undefined, [
                        ts.factory.createFalse(),
                      ]),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              );
              cctx.instance.unshift(refStatement);
              return [
                ts.factory.createCallExpression(ts.factory.createIdentifier("useEffect"), undefined, [
                  newCallback,
                  // always
                ]),
              ];
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
  // const dispatcherNames = new Set<string>();
  for (const stmt of inputFile.statements) {
    // handle top level value declaration
    if (ts.isVariableStatement(stmt)) {
      const isPropsMember = stmt.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      const isLetDecl = stmt.declarationList.flags & ts.NodeFlags.Let;
      for (const decl of stmt.declarationList.declarations) {
        // console.log("finding dispatcher", decl.initializer);
        if (
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression) &&
          decl.initializer.expression.text === "createEventDispatcher"
        ) {
          if (ts.isIdentifier(decl.name)) {
            cctx.dispatcherNames.add(decl.name.text);
          }
          // console.log("find dispatcher!");
          // throw "stop";
          const eventTypeMap = decl.initializer.typeArguments?.[0];
          // TODO: trace type declaration
          // if (firstTypeArg && ts.isTypeReferenceNode(firstTypeArg)) {
          // }
          if (eventTypeMap && ts.isTypeLiteralNode(eventTypeMap)) {
            for (const member of eventTypeMap.members) {
              if (
                ts.isPropertySignature(member) &&
                member.name &&
                ts.isIdentifier(member.name) &&
                member.type &&
                ts.isTypeLiteralNode(member.type)
              ) {
                const eventName = member.name.text;
                // console.log("event name", member);
                // throw new Error("Not supported: dynamic event name");
                // const reactEventName = getReactEventName(eventName);
                const eventHandlerName = `on${eventName[0].toUpperCase()}${eventName.slice(1)}`;
                cctx.eventMap.set(eventHandlerName, member.type);
              }
            }
          }
          continue;
        }

        // let
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
  const propsTypeLiteral = ts.factory.createTypeLiteralNode([
    ...propMembers.map((prop) => {
      const name = prop.name as ts.Identifier;
      const type = prop.type ?? ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
      const questionToken = prop.initializer != null ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined;
      return ts.factory.createPropertySignature(undefined, name, questionToken, type);
    }),
    ...[...cctx.eventMap.entries()].map(([name, typeLiteral]) => {
      return ts.factory.createPropertySignature(
        undefined,
        ts.factory.createIdentifier(name),
        ts.factory.createToken(ts.SyntaxKind.QuestionToken),
        ts.factory.createFunctionTypeNode(
          undefined,
          [
            ts.factory.createParameterDeclaration(
              undefined,
              undefined,
              ts.factory.createIdentifier("data"),
              undefined,
              typeLiteral,
              undefined,
            ),
          ],
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
        ),
      );
    }),
  ]);

  const propsInitializer = ts.factory.createObjectBindingPattern([
    ...propMembers.map((prop) => {
      return ts.factory.createBindingElement(undefined, undefined, prop.name as ts.Identifier, prop.initializer);
    }),
    ...[...cctx.eventMap.keys()].map((name) => {
      return ts.factory.createBindingElement(undefined, undefined, ts.factory.createIdentifier(name), undefined);
    }),
  ]);

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

function templateToTsx(root: Fragment, aliasMap: Map<string, string>, cctx: ConvertContext) {
  return _visit(root, true, 0);

  function _visit(node: BaseNode, isElementChildren: boolean, depth = 0): ts.Node {
    // console.log("  ".repeat(depth) + `[${node.type}]`, node.children?.length ?? 0);
    switch (node.type) {
      case "Text": {
        if (isElementChildren) {
          return ts.factory.createJsxText(node.data);
        } else {
          return ts.factory.createStringLiteral(node.data);
        }
      }
      case "DebugTag": {
        return ts.factory.createJsxExpression(
          undefined,
          ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("console"), "log"),
            undefined,
            [
              ts.factory.createObjectLiteralExpression(
                (node.identifiers ?? []).map((ident: Identifier) => {
                  return ts.factory.createShorthandPropertyAssignment(ts.factory.createIdentifier(ident.name));
                }),
              ),
            ],
          ),
        );
      }
      case "MustacheTag": {
        const expr = estreeExprToTsExpr(node.expression);
        return ts.factory.createJsxExpression(undefined, expr);
      }
      case "RawMustacheTag": {
        // TODO: now I use dangerouslySetInnerHTML but should I use ref.current.innerHTML?
        const expr = estreeExprToTsExpr(node.expression);
        return ts.factory.createJsxSelfClosingElement(
          ts.factory.createIdentifier("div"),
          undefined,
          ts.factory.createJsxAttributes([
            ts.factory.createJsxAttribute(
              ts.factory.createIdentifier("dangerouslySetInnerHTML"),
              ts.factory.createJsxExpression(
                undefined,
                ts.factory.createObjectLiteralExpression([
                  ts.factory.createPropertyAssignment(ts.factory.createIdentifier("__html"), expr),
                ]),
              ),
              // ts.factory.createJsxExpression(undefined, expr),
            ),
          ]),
        );
      }

      case "IfBlock": {
        const expr = estreeExprToTsExpr(node.expression) as ts.Expression;
        const children = (node.children ?? []).map((child) => _visit(child, true, depth + 1));
        const elseBlock = node.else
          ? (_visit(node.else, true, depth + 1) as ts.Expression)
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
        const children = (node.children ?? []).map((child) => _visit(child, true, depth + 1));
        return ts.factory.createJsxFragment(
          ts.factory.createJsxOpeningFragment(),
          children as ts.JsxChild[],
          ts.factory.createJsxJsxClosingFragment(),
        );
      }
      case "KeyBlock": {
        cctx.reactFeatures.add("Fragment");
        const expr = estreeExprToTsExpr(node.expression) as ts.Expression;
        const children = (node.children ?? []).map((child) => _visit(child, true, depth + 1));
        return ts.factory.createJsxElement(
          ts.factory.createJsxOpeningElement(
            ts.factory.createIdentifier("Fragment"),
            undefined,
            ts.factory.createJsxAttributes([
              ts.factory.createJsxAttribute(
                ts.factory.createIdentifier("key"),
                ts.factory.createJsxExpression(undefined, expr),
              ),
            ]),
          ),
          children as ts.JsxChild[],
          ts.factory.createJsxClosingElement(ts.factory.createIdentifier("Fragment")),
        );
      }
      case "EachBlock": {
        // console.log("each", node);
        const expr = estreeExprToTsExpr(node.expression) as ts.Expression;
        const children = (node.children ?? []).map((child) => _visit(child, true, depth + 1));
        // TODO: handle as expr
        const contextName = ts.factory.createIdentifier(node.context.name);
        // const contextName = ts.factory.createIdentifier(node.key);
        const hasKey = node.key != null;
        const hasIndex = node.index != null;

        if (hasKey || hasIndex) {
          cctx.reactFeatures.add("Fragment");
        }
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
                  ts.factory.createParameterDeclaration(
                    undefined,
                    undefined,
                    contextName,
                    undefined,
                    undefined,
                    undefined,
                  ),
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
                ts.factory.createJsxElement(
                  ts.factory.createJsxOpeningElement(
                    ts.factory.createIdentifier("Fragment"),
                    undefined,
                    ts.factory.createJsxAttributes(
                      // key={key}
                      hasKey
                        ? [
                            ts.factory.createJsxAttribute(
                              ts.factory.createIdentifier("key"),
                              ts.factory.createJsxExpression(undefined, estreeExprToTsExpr(node.key)),
                            ),
                          ]
                        : // use index as key
                        hasIndex
                        ? [
                            ts.factory.createJsxAttribute(
                              ts.factory.createIdentifier("key"),
                              ts.factory.createJsxExpression(undefined, ts.factory.createIdentifier(node.index)),
                            ),
                          ]
                        : [],
                    ),
                  ),
                  children as ts.JsxChild[],
                  ts.factory.createJsxClosingElement(ts.factory.createIdentifier("Fragment")),
                ),
              ),
            ],
          ),
        );
      }

      case "AwaitBlock": {
        throw new Error("Not supported: {#await}");
      }
      case "EventHandler": {
        const expr = estreeExprToTsExpr(node.expression);
        const name = node.name;
        const eventName = getReactEventNameFromHandlerName(name);
        return ts.factory.createJsxAttribute(
          ts.factory.createIdentifier(eventName),
          ts.factory.createJsxExpression(undefined, expr),
        );
      }
      case "AttributeShorthand": {
        return ts.factory.createJsxExpression(undefined, ts.factory.createIdentifier(node.expression.name));
      }
      case "Spread": {
        const expr = estreeExprToTsExpr(node.expression);
        return ts.factory.createJsxSpreadAttribute(expr);
      }
      case "Attribute": {
        const name = node.name;
        // TODO: handle array
        const value = node.value[0] ?? "";
        const attrName = getReactAttributeName(name);
        // use alias map to convert
        if (attrName === "className" && value.type === "Text") {
          const classSelectors: string[] = [];
          const classRaws: string[] = [];
          value.data.split(" ").map((cls: string) => {
            if (aliasMap.has(cls)) {
              classSelectors.push(aliasMap.get(cls)!);
            } else {
              // alert
              classRaws.push(cls);
            }
          });
          // className={[selector$aaa, selector$bbb].join(' ')}
          return ts.factory.createJsxAttribute(
            ts.factory.createIdentifier(attrName),
            ts.factory.createJsxExpression(
              undefined,
              ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createArrayLiteralExpression([
                    ...classSelectors.map((cls) => ts.factory.createIdentifier(cls)),
                    ...classRaws.map((cls) => ts.factory.createStringLiteral(cls)),
                  ]),
                  "join",
                ),
                undefined,
                [ts.factory.createStringLiteral(" ")],
              ),
            ),
          );
        } else {
          const right = _visit(value, false, depth + 1) as ts.JsxAttributeValue;
          return ts.factory.createJsxAttribute(ts.factory.createIdentifier(attrName), right);
        }
      }
      case "Slot": {
        const isNamedSlot = (node.attributes ?? []).some((attr: Attribute) => attr.name === "name");
        if (isNamedSlot) {
          // TODO: handle named slot
          throw new Error("Not supported: named slot");
        } else {
          cctx.hasDefaultSlot = true;
        }
        return ts.factory.createJsxExpression(undefined, ts.factory.createIdentifier("children"));
      }
      case "InlineComponent":
      case "Element": {
        let tagName: string;
        if (node.name === "svelte:self") {
          tagName = "Component";
          cctx.hasSelf = true;
        } else if (node.name === "svelte:component") {
          // const thisIdent = node.expression as Identifier;
          tagName = node.expression.name;
          // console.log("bounded", boundedThis, node);
          // const expression = boundedThis?.value[0];
          // throw "stop";
          // tagName = "This";
          // if (boundedThis) {
        } else {
          tagName = node.name as string;
        }
        // if (node.name === "svelte:component") {
        //   tagName = "Component";
        //   cctx.hasSelf = true;
        // } else {
        //   tagName = node.name as string;
        // }

        // TODO: handle component tag
        // const tagName = node.name === "svelte:self" ? "Self" : node.name as string;
        // cctx.hasSelf = true;
        // console.log("tagName?", tagName);

        const attributes = node.attributes.map((attr: Attribute) => {
          return _visit(attr, false, depth + 1);
        });

        const children = (node.children ?? []).map((child) => _visit(child, true, depth + 1));
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
            const expr = _visit(child as BaseNode, true, depth + 1);
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
}

const typeOnlyReactFeatures = new Set(["ReactNode", "ReactElement", "ReactEventHandler", "ReactHTML"]);
function buildFile(template: ts.Statement[], parsedCss: ParsedStyle, cctx: ConvertContext): ts.SourceFile {
  const reactImportDeclaration =
    cctx.reactFeatures.size > 0
      ? [
          ts.factory.createImportDeclaration(
            undefined,
            // undefined,
            ts.factory.createImportClause(
              false,
              undefined,
              ts.factory.createNamedImports(
                [...cctx.reactFeatures].map((feature) => {
                  if (typeOnlyReactFeatures.has(feature)) {
                    return ts.factory.createImportSpecifier(true, undefined, ts.factory.createIdentifier(feature));
                  }
                  return ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(feature));
                }),
              ),
            ),
            ts.factory.createStringLiteral("react"),
          ),
        ]
      : [];
  let cssImports: ts.Statement[] = [];
  if (parsedCss.statements.length > 0) {
    // reactImportDeclaration.push(
    const linariaImportDeclaration = ts.factory.createImportDeclaration(
      undefined,
      // undefined,
      ts.factory.createImportClause(
        false,
        undefined,
        ts.factory.createNamedImports([
          ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier("css")),
        ]),
      ),
      // TODO: change option to switch css library
      ts.factory.createStringLiteral("@linaria/core"),
    );
    cssImports = [linariaImportDeclaration];
  }
  return ts.factory.createSourceFile(
    [...reactImportDeclaration, ...cssImports, ...cctx.toplevel, ...template, ...parsedCss.statements],
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
      .red {
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

  test("complex", () => {
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
      .red {
        color: red;
      }
    </style>
`;
    // const preparsed = preparse(code);
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log("-------------");
    // console.log(formatted);
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
      .red {
        color: red;
      }
    </style>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log("-------------");
    // console.log(formatted);
    expect(formatted).toContain("export const exported: number = 1;");
  });

  test("svelte builtin", () => {
    const code = `
    <script lang="ts">
      import { afterUpdate, beforeUpdate, onMount, onDestroy } from "svelte";
      onMount(() => {
        console.log("mounted");
        return () => {
          console.log("unmount");
        }
      });
      onDestroy(() => {
        console.log("destroy");
      });
      beforeUpdate(() => {
        console.log("before update");
      });
      afterUpdate(() => {
        console.log("after update");
      });
    </script>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log("-------------");
    // console.log(formatted);
    expect(formatted).toContain(`import { useEffect, useRef } from "react";`);
    expect(formatted).toContain(`_ref0.current = true`);
  });

  test("template", () => {
    const code = `
    <div {id} class={className}>
      <h1>Nest</h1>
      hello, {x}
    </div>
    <div {...obj} />
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
    {#each items as item (item.id)}
      <span>{item.name}</span>
    {/each}
    {#key 1}
      <span>key</span>
    {/key}
    <!-- WIP
    {#await new Promise(r => r())}
      <span>await</span>
    {:then value}
      <span>then</span>
    {:catch error}
      <span>catch</span>
    {/await}
    -->
    <button on:click={onClick}>click</button>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log("-------------");
    // console.log(formatted);
    expect(formatted).toContain(`import { Fragment } from "react";`);
    // assign and shorthand
    expect(formatted).toContain("<div id={id} className={className}>");
    // spread
    expect(formatted).toContain("<div {...obj}></div>");
    // on:click
    expect(formatted).toContain("<button onClick={onClick}");
    // each
    expect(formatted).toContain("[1, 2, 3].map((num, i) => (");
    expect(formatted).toContain("items.map((item) => (");
    expect(formatted).toContain("<Fragment key={item.id}>");
    // if
    expect(formatted).toContain("{true ? (");
    // else
    expect(formatted).toContain(") : (");
    expect(formatted).toContain("if-true");
    expect(formatted).toContain("<>else if block</>");
    expect(formatted).toContain(": <>else block</>");
    expect(formatted).toContain("<Fragment key={1}>");
  });

  test("computed", () => {
    const code = `
    <script lang="ts">
      let v = 1;
      $: computed = v + 1;
      $: document.title = \`computed: \${computed}\`;
      $: {
        console.log(v);
      }
    </script>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log("-------------");
    // console.log(formatted);
    expect(formatted).toContain(`import { useState } from "react";`);
    expect(formatted).toContain(`const [v, set$v] = useState(1);`);
    expect(formatted).toContain(`const computed = v + 1;`);
    expect(formatted).toContain(`document.title = \`computed: \${computed}\`;`);
    expect(formatted).toContain(`, [computed])`);
    expect(formatted).toContain(`, [v])`);
  });

  test("special tags", () => {
    const code = `
    {@html "<div>html</div>"}
    {@debug v}
    <!-- {@const x = 1} -->
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log("-------------");
    // console.log(formatted);
    expect(formatted).toContain(`<div dangerouslySetInnerHTML={{ __html: "<div>html</div>" }} />`);
    expect(formatted).toContain(`{console.log({ v })}`);
  });

  test("events", () => {
    const code = `
    <script lang="ts">
    import {createEventDispatcher} from "svelte";
    const dispatch = createEventDispatcher<{
      message: {
        text: string;
      };
    }>();
    const onClick = () => {
      dispatch('message', {
        text: 'Hello!'
      });
    }
  </script>
  <div on:click={onClick}>
    hello
  </div>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log("-------------");
    // console.log(formatted);
    expect(formatted).toContain(`onMessage?: (data: { text: string }) => void`);
    expect(formatted).toContain(`onMessage?.({`);
  });

  test("svelte:self / svelte:component", () => {
    const code = `
    <script lang="ts">
      export let depth: number;
      import Foo from "./Foo.svelte";
      import Bar from "./Bar.svelte";
      const Baz = Bar;
    </script>
    <Foo />
    <svelte:component this={Baz} />
    {#if depth < 3}
      <svelte:self depth={depth + 1}/>
    {/if}
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log(formatted);
    // TODO: Self closing if no children
    expect(formatted).toContain(`<Foo></Foo>`);
    expect(formatted).toContain(`<Baz></Baz>`);
    expect(formatted).toContain(`function Component(`);
    expect(formatted).toContain(`<Component depth={depth + 1}></Component>`);
  });

  test("slots", () => {
    const code = `
    <script lang="ts">
      import Foo from "./Foo.svelte";
      import Bar from "./Bar.svelte";
    </script>

    <slot></slot>
    <!-- <slot name="xxx"></slot> -->
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log(formatted);
    expect(formatted).toContain(`import { type ReactNode } from "react";`);
    expect(formatted).toContain(`({ children }: `);
    expect(formatted).toContain(`{ children?: ReactNode }`);
    expect(formatted).toContain(`<>{children}</>`);
  });

  test("property name", () => {
    const code = `
    <div class="c" on:click={onClick} on:keypress={onKeyPress}></div>
    <label for="foo">label</label>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log(formatted);
    // expect(formatted).toContain(`className="c"`);
    expect(formatted).toContain(`<label htmlFor="foo">`);
  });

  test("selector to css", () => {
    const code = `
    <div class="red container">
    </div>
    <span class="red">text</span>
    <span class="raw">text</span>
    <style>
      .container {
        display: flex;
      }
      .red {
        color: red;
      }
    </style>
`;
    const result = svelteToReact(code);
    const formatted = prettier.format(result, { filepath: "input.tsx", parser: "typescript" });
    // console.log(formatted);
    expect(formatted).toContain(`className={[selector$red].join(" ")}`);
    expect(formatted).toContain(`className={["raw"].join(" ")}`);
    expect(formatted).toContain(`const selector$red = css\``);
    expect(formatted).toContain(`const selector$container = css\``);
    // expect(formatted).toContain(`className={\`red\`}`);
    // expect(formatted).toContain(`className="c"`);
    // expect(formatted).toContain(`<label htmlFor="foo">`);
  });

  test("throw unsuporretd", () => {
    try {
      svelteToReact(`<slot name="xxx"></slot>`);
      throw new Error("unreachable");
    } catch (err) {
      if (err instanceof Error) {
        expect(err.message).toContain("Not supported: named slot");
      } else {
        throw err;
      }
    }
    try {
      svelteToReact(`
    {#await new Promise(r => r())}
      <span>await</span>
    {:then value}
      <span>then</span>
    {:catch error}
      <span>catch</span>
    {/await}
`);
      throw new Error("unreachable");
    } catch (err) {
      if (err instanceof Error) {
        expect(err.message).toContain("Not supported: {#await}");
      } else {
        throw err;
      }
    }

    // TODO: Self closing if no children
    // expect(formatted).toContain(`<Foo></Foo>`);
    // expect(formatted).toContain(`<Baz></Baz>`);
    // expect(formatted).toContain(`function Component(`);
    // expect(formatted).toContain(`<Component depth={depth + 1}></Component>`);
    // expect(formatted).toContain(`onMessage?.({`);
  });
}
