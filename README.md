# svelte2tsx-component

svelte(`lang='ts'`) template to react component converter (PoC)

```bash
$ npm install svelte2tsx-component -D

# default css generator is @emotion/css
$ npm install react react-dom @types/react @types/react-dom @emotion/css -D
```

## Concepts

- Generate Component Props Type from `script lang="ts"`, leaving TypeScript type information
- Convert svelte's built-in functionality into an idiom on React with similar results
- Import `.svelte` transparently from React

### API

```ts
import { svelteToTsx } from "svelte2tsx-component";
const code = "<div></div>";
const tsxCode = svelteToTsx(code);
```

### with vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { plugin as svelteToTsx } from "svelte-to-tsx";
import ts from "typescript";

export default defineConfig({
  plugins: [svelteToTsx({
    extensions: [".svelte"],
    tsCompilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    }
  })],
});
```

## Examples

svelte template

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  export let foo: number;
  export let bar: number = 1;

  const x: number = 1;
  let mut = 2;
  onMount(() => {
    console.log("mounted");
    mut = 4;
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
<button on:click={onClick}>click</button>
<style>
  div {
    color: red;
  }
</style>
```

to tsx react component

```ts
import { useEffect, useState } from "react";
export default ({ foo, bar = 1 }: { foo: number; bar?: number }) => {
  const x: number = 1;
  const [mut, set$mut] = useState(2);
  useEffect(() => {
    console.log("mounted");
    set$mut(4);
  }, []);
  const onClick = () => {
    console.log("clicked");
    set$mut(mut + 1);
  };
  const className = "cls";
  return (
    <>
      <div id="x" className={className}>
        <h1>Nest</h1>
        hello, {x}
      </div>
      <button onClick={onClick}>click</button>
    </>
  );
};
```

so you can use like this.

```ts
import React from "react";
import App from "./App.svelte";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root")!;

createRoot(root).render(<App
  name="svelte-app"
  onMessage={(data) => {
    console.log("message received", data)
  }
} />);
```

(put `App.svelte.d.ts` manually yet)

## Transform Convensions

### PropsType with export let

svelte

```svelte
<script lang="ts">
  export let foo: number;
  export let bar: number = 1;
</script>
```

tsx

```tsx
export default ({ foo, bar = 1 }: { foo: number, bar?: number }) => {
  return <></>
}
```

### PropsType with svelte's createEventDispatcher

svelte

```svelte
<script lang="ts">
import {createEventDispatcher} from "svelte";
// Only support ObjectTypeLiteral (TypeReference not supported)
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
```

tsx

```tsx
export default ({
  onMessage,
}: {
  onMessage?: (data: { text: string }) => void;
}) => {
  const onClick = () => {
    onMessage?.({
      text: "Hello!",
    });
  };
  return (
    <>
      <div onClick={onClick}>hello</div>
    </>
  );
};
```

### Expression in svelte template

Supported

```svelte
<div id="myid"></div>
<div id={expr}></div>
<div {id}></div>
<div {...params}></div>
```

Not supported (yet)

```svelte
<div id="{expr}"></div>
```

### onMount / onDestroy / beforeUpdate / afterUpdate

Convert to react's `useEffect`

### Style

```svelte
<span class="red">text</span>
<style>
  .red: {
    color: red;
  }
</style>
```

to

```tsx
// Auto import with style block
import { css } from "@emotion/css";

// in tsx
<span className={style$red}>text</span>

const selector$red = css`
  color: red;
`;
```

Only support **single class selector** like `.red`.

Not Supported these patterns.

```css
.foo > .bar {}

div {}

:global(div) {}
```

### Unsupported features

- [ ] Await Block
- [ ] Property Bindings `<input bind:value />`
- `<svelte:options />`
- `svelte` 's `setContext` / `getContext` / `tick` / `getAllContexts`
- `svelte/motion`
- `svelte/store`
- `svelte/animation`
- `svelte/transition`
- `svelte/action`
- `<Foo let:prop />`
- css: `:global()`

(Checkboxed item may be supportted latter)

Currently, the scope is not parsed, so unintended variable conflicts may occur.

## Basic Features

- [x] Module: `<script context=module>`
- [x] Props Type: `export let foo: number` to `{foo}: {foo: number}`
- [x] Props Type: `export let bar: number = 1` to `{bar = 1}: {bar?: number}`
- [x] svelte: `onMount(() => ...)` => `useEffect(() => ..., [])`
- [x] svelte: `onDestroy(() => ...)` => `useEffect(() => { return () => ... }, [])`
- [x] svelte: `dispatch('foo', data)` => `onFoo?.(data)`
- [x] svelte: `beforeUpdate()` => `useEffect`
- [x] svelte: `afterUpdate()` => `useEffect` (omit first change)
- [x] Let: `let x = 1` => `const [x, set$x] = setState(1)`
- [x] Let: `x = 1` => `set$x(1)`;
- [x] Computed: `$: added = v + 1;`
- [x] Computed: `$: document.title = title` => `useEffect(() => {document.title = title}, [title])`
- [x] Computed: `$: { document.title = title }` => `useEffect(() => {document.title = title}, [title])`
- [x] Computed: `$: <expr-or-block>` => `useEffect()`
- [x] Template: `<div>1</div>` to `<><div>1</div></>`
- [x] Template: `<div id="x"></div>` to `<><div id="x"></div></>`
- [x] Template: `<div id={v}></div>` to `<><div id={v}></div></>`
- [x] Template: `<div on:click={onClick}></div>` to `<div onClick={onClick}></div>`
- [x] Template: `{#if ...}`
- [x] Template: `{:else if ...}`
- [x] Template: `{/else}`
- [x] Template: `{#each items as item}`
- [x] Template: `{#each items as item, idx}`
- [x] Template: `{#key <expr>}`
- [x] Template: with key `{#each items as item (item.id)}`
- [x] Template: Shorthand assignment `{id}`
- [x] Template: Spread `{...v}`
- [x] SpecialTag: RawMustacheTag `{@html <expr}`
- [x] SpecialTag: DebugTag `{@debug "message"}`
- [x] SpecialElements: default slot: `<slot>`
- [x] SpecialElements: `<svelte:self>`
- [x] SpecialElements: `<svelte:component this={currentSelection.component} foo={bar} />`
- [x] Template: attribute name converter like `class` => `className`, `on:click` => `onClick`
- [x] Style: `<style>` tag to `@emotion/css`
- [ ] Style: option for `import {css} from "..."` importer
- [x] Plugin: transparent svelte to react loader for rollup or vite

## TODO

- [ ] Template: Await block `{#await <expr>}`
- [ ] Computed: `$: ({ name } = person)`
- [ ] Directive: `<div contenteditable="true" bind:innerHTML={html}>`
- [ ] Directive: `<img bind:naturalWidth bind:naturalHeight></img>`
- [ ] Directive: `<div bind:this={element}>`
- [ ] Directive: `class:name`
- [ ] Directive: `style:property`
- [ ] Directive: `use:action`
- [ ] SpecialElements: `<svelte:window />`
- [ ] SpecialElements: `<svelte:document />`
- [ ] SpecialElements: `<svelte:body />`
- [ ] SpecialElements: `<svelte:element this={expr} />`
- [ ] SpecialTag: ConstTag `{@const v = 1}`
- [ ] Directive: `<div on:click|preventDefault={onClick}></div>`
- [ ] Directive: `<span bind:prop={}>`
- [ ] Directive: `<Foo let:xxx>`
- [ ] Directive: event delegation `<Foo on:trigger>`
- [ ] SpecialElements: `<svelte:fragment>`
- [ ] SpecialElements: named slots: `<slot name="...">`
- [ ] SpecialElements: `$$slots`
- [ ] Generator to `.svelte` => `.svelte.d.ts`

## Why?

Svelte templates are not difficult to edit with only HTML and CSS knowledge, but the modern front-end ecosystem revolves around JSX.

However, the modern front-end ecosystem revolves around JSX, and we think we need a converter that transparently treats Svelte templates as React components. I think so.

(This is my personal opinion).

## Prior Art

- https://github.com/amen-souissi/svelte-to-react-compiler

## LICENSE

MIT