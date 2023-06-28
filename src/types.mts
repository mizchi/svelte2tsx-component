import type ts from "typescript";

export type CssImporter = "@emotion/css" | "@linaria/core" | "styled-components";
export type JsxImporter = "react" | "preact/compat";
export type hooksImporter = (apiName: string, jsx: JsxImporter) => [apiName: string, importer: string];

/** Outcoming */
export type Options = {
  warn?: (message: string, pos: [start: number, end: number]) => void;
  cssImporter?: CssImporter;
  jsxImporter?: JsxImporter;
  hooksImporter?: hooksImporter;
};

export type InternalOptions = {
  warn: (message: string, pos: [start: number, end: number]) => void;
  cssImporter: CssImporter;
  jsxImporter: JsxImporter;
  hooksImporter: hooksImporter;
};

export type PluginOptions = Options & {
  tsCompilerOptions?: ts.CompilerOptions;
  extensions?: string[];
};

/** @internal */
export type Parsed = {
  html: string;
  styleTags: string[];
  scriptTags: Array<{ lang?: string; module: boolean; code: string }>;
};

/** @internal */
export type ParsedComponentSignature = {
  propsTypeLiteral: ts.TypeLiteralNode;
  propsInitializer: ts.ObjectBindingPattern;
};

/** @internal */
export type ParsedStyle = {
  aliasMap: Map<string, string>;
  statements: ts.Statement[];
};

/** @internal */
export type ConvertContext = {
  warn: (message: string, pos: [start: number, end: number]) => void;
  options: InternalOptions;
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
