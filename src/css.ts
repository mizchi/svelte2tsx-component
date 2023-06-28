import { parse } from "postcss";
import ts from "typescript";
import { toSafeIdentifier } from "./utils";

export function buildCss(cssCode: string): {
  statements: ts.Statement[];
  aliasMap: Map<string, string>;
} {
  // let id = 0;
  // const uniqKey = () => `s${id++}`;
  // const process = postcss([]).plugins;
  const parser = parse(cssCode);

  const aliasMap = new Map<string, string>();
  // const result = stringify(parser);
  // console.log(parser);
  const stmts: ts.Statement[] = [];

  parser.walkRules((rule) => {
    const selector = rule.selector;
    if (!selector.startsWith(".")) {
      throw new Error("Not supported: only support single class selector");
    }
    // console.log(selector);
    const ruleSet = new Set<string>();
    for (const node of rule.nodes) {
      if (node.type === "decl") {
        // console.log(node.prop, node.value);
        ruleSet.add(`${node.prop}: ${node.value}`);
      }
    }
    const ruleBody =
      Array.from(ruleSet)
        .map((t) => `\n  ${t}`)
        .join(";") + "\n";

    const newSelector = toSafeIdentifier("selector$" + selector.slice(1));
    aliasMap.set(selector.replace(/^\./, ""), newSelector);
    const cssStmt = ts.factory.createVariableStatement(
      undefined,
      ts.factory.createVariableDeclarationList(
        [
          ts.factory.createVariableDeclaration(
            ts.factory.createIdentifier(newSelector),
            undefined,
            undefined,
            ts.factory.createTaggedTemplateExpression(
              ts.factory.createIdentifier("css"),
              undefined,
              ts.factory.createNoSubstitutionTemplateLiteral(ruleBody, ruleBody),
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    );
    stmts.push(cssStmt);
  });
  return {
    statements: stmts,
    aliasMap,
  };
  // return gulp.src('src/**/*.css')
  //   .pipe(gulp.dest('dist'));
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test("convert css", () => {
    const css = `
    .aaa {
      color: red;
      text-align: center;
    }
    `;
    const { statements, aliasMap } = buildCss(css);
    const source = ts.factory.createSourceFile(
      [...statements],
      ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
      ts.NodeFlags.None,
    );
    // console.log(ts.createPrinter().printFile(source));
    // console.log(aliasMap);
    // expect(result).toBe(`
    // .a {
    //   color: red;
    // }
    // `);
  });
}
