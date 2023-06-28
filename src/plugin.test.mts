import { plugin } from "./plugin.mjs";
import { test, expect } from "vitest";
import { rollup } from "rollup";
import ts from "typescript";

test("convert svelte", async () => {
  const vitualFileMap: Record<string, string> = {
    "input.tsx": `
import Component from "component.svelte";
import ReactDOMClient from "react-dom/client";
const root = document.getElementById("root");
ReactDOMClient.createRoot(root).render(<Component name="world" />);
`,
    "component.svelte": `
<script lang="ts">
  export let name: string;
</script>
<div>
  <h1 class="title">Hello {name}</h1>
</div>
<style>
  .title {
    color: red;
  }
</style>
`,
  };
  const bundle = await rollup({
    input: "input.tsx",
    external: ["react", "react/jsx-runtime", "react-dom/client", "@emotion/css"],
    plugins: [
      {
        name: "memory-loader",
        resolveId(id, importer) {
          // console.log("[memory:resolveId]", id, importer);
          if (id in vitualFileMap) {
            // console.log("[memory:resolveId]", id, importer);
            return id;
          }
        },
        load(id) {
          if (id in vitualFileMap) {
            // console.log("[memory:load]", id, vitualFileMap[id].length);
            // preprocess jsx
            if (id.endsWith(".tsx")) {
              const raw = vitualFileMap[id];
              const transpiled = ts.transpileModule(raw, {
                compilerOptions: {
                  module: ts.ModuleKind.ESNext,
                  target: ts.ScriptTarget.ESNext,
                  jsx: ts.JsxEmit.ReactJSX,
                  sourceMap: true,
                },
              });
              return transpiled.outputText;
            }
            return vitualFileMap[id];
          }
        },
      },
      plugin({}),
    ],
  });
  const out = await bundle.generate({
    format: "es",
  });
  const outputCode = out.output[0].code;
  // console.log(outputCode);
  expect(outputCode).toContain("import { jsx, Fragment, jsxs } from 'react/jsx-runtime'");
  expect(outputCode).toContain("import { css } from '@emotion/css'");
  expect(outputCode).toContain("var Component = ({ name }) => {");
});
// }
