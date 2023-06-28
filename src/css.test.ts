import ts from "typescript";

import { test, expect } from "vitest";
import { buildCss } from "./css";
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
});
