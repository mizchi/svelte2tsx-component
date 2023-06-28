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
