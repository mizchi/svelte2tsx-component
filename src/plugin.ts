import { type Plugin } from "rollup";
import path from "node:path";
import { svelteToTsx } from "./core";
import ts from "typescript";
import { PluginOptions } from "./types";

export const plugin: (opts: PluginOptions) => Plugin = ({
  tsCompilerOptions,
  extensions = [".svelte", ".tsx.svelte"],
  ...options
} = {}) => {
  return {
    name: "svelte-to-tsx",
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
        const tsxCode = svelteToTsx(code, options);
        const transpiled = ts.transpileModule(tsxCode, {
          compilerOptions: tsCompilerOptions ?? {
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
