import { type Plugin } from "rollup";
import path from "node:path";
import { svelteToReact } from ".";
import ts from "typescript";

type Options = {
  extensions?: string[];
};

export const plugin: (opts: Options) => Plugin = ({ extensions = [".svelte", ".tsx.svelte"] }) => {
  return {
    name: "svelte-to-react",
    resolveId(source, importer) {
      if (importer == null) {
        return;
      }
      const fpath = path.resolve(importer, source);
      if (extensions.some((ext) => fpath.endsWith(ext))) {
        // TODO: Rename to .tsx to delegate other plugins?
        return fpath;
      }
    },
    transform(code, id) {
      if (id.endsWith(".svelte")) {
        // console.log("[svelte-to-react]", id, code);
        const tsxCode = svelteToReact(code);
        // console.log("[svelte-to-react:converted]", tsxCode);
        const transpiled = ts.transpileModule(tsxCode, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            sourceMap: true,
          },
        });
        return {
          code: transpiled.outputText,
          map: transpiled.sourceMapText,
        };
      }
    },
  };
};

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  const rollup = await import("rollup");

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
    const bundle = await rollup.rollup({
      input: "input.tsx",
      external: ["react", "react/jsx-runtime", "react-dom/client", "@linaria/core"],
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
    expect(outputCode).toContain("import { css } from '@linaria/core'");
    expect(outputCode).toContain("var Component = ({ name }) => {");
  });
}
