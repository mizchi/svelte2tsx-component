# Svelte to React Converter (PoC)

Convert svelte template to react component

## Why?

Svelte templates are not difficult to edit with only HTML and CSS knowledge, but the modern front-end ecosystem revolves around JSX.

However, the modern front-end ecosystem revolves around JSX, and we think we need a converter that transparently treats Svelte templates as React components. I think so.

(This is my personal opinion).

## Example

(not published yet)

Convert this template.

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

to 

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

## Features (to v1)

- [ ] Module: `<script context=module>`
- [x] Props Type: `export let foo: number` to `{foo}: {foo: number}`
- [x] Props Type: `export let bar: number = 1` to `{bar = 1}: {bar?: number}`
- [x] svelte: `onMount(() => ...)` => `useEffect(() => ..., [])`
- [x] svelte: `onDestroy(() => ...)` => `useEffect(() => { return () => {...} }, [])`
- [ ] svelte: `createEventDispatcher()`
- [ ] svelte: `beforeUpdate()`
- [ ] svelte: `afterUpdate()`
- [x] Let: `let x = 1` => `const [x, set$x] = setState(1)`
- [x] Let: `x = 1` => `set$x(1)`;
- [ ] Let: `export let val` and `val = 2` => `props: { onChangeVal: (newVal) => void }` and `onChangeVal(2)`
- [ ] Computed: `$: added = v + 1;`
- [ ] Computed: `$: ({ name } = person)`
- [ ] Computed: `$: document.title = title` => `useEffect(() => {document.title = title}, [title])`
- [ ] Computed: `$: <expr-or-block>` => `useEffect()`
- [x] Template: `<div>1</div>` to `<><div>1</div></>`
- [x] Template: `<div id="x"></div>` to `<><div id="x"></div></>`
- [x] Template: `<div id={v}></div>` to `<><div id={v}></div></>`
- [x] Template: `<div on:click={onClick}></div>` to `<div onClick={onClick}></div>`
- [x] Template: `{#if ...}`
- [x] Template: `{:else if ...}`
- [x] Template: `{/else}`
- [x] Template: `{#each items as item}`
- [x] Template: `{#each items as item, idx}`
- [ ] Template: `{#await <expr>} ... {:then <name>} {:catch <name>} {/await}`
- [ ] Template: `{#key <expr>}`
- [ ] Template: with key `{#each items as item (item.id)}`
- [ ] Template: Shorthand assignment `{id}`
- [ ] Template: Spread `{...v}`
- [ ] SpecialTag: `{@html <expr}`
- [ ] SpecialTag: `{@debug mes}`
- [ ] SpecialTag: `{@const v = 1}`
- [ ] Directive: `<div on:click|preventDefault={onClick}></div>`
- [ ] Directive: `<span bind:prop={}>`
- [ ] Directive: `<Foo let:xxx>`
- [ ] Directive: event delegation `<Foo on:trigger>`
- [ ] SpecialElements: `<svelte:fragment>`
- [ ] SpecialElements: `<slot>`
- [ ] SpecialElements: `$$slots`
- [ ] SpecialElements: `<svelte:self>`
- [ ] SpecialElements: `<svelte:component this={currentSelection.component} foo={bar} />`
- [ ] SpecialElements: `<svelte:element this={expr} />`
- [ ] Style: `<style>` tag to something (`styled-components` or `emotion`?)
- [ ] Plugin: transparent svelte to react loader for rollup or vite

## Low Proiority

- [ ] svelte: `const v = getContext(...)` => `const v = useContext(...)`
- [ ] svelte: `setContext(key, val)` => `<Context.Provider value={...}>...</Context.Provider>`
- [ ] svelte: `getContext(key)` => `useContext`
- [ ] svelte: `hasContext(key)`
- [ ] svelte: `tick()`
- [ ] svelte/store
- [ ] svelte/motion
- [ ] svelte/transition
- [ ] svelte/animate
- [ ] svelte/easing
- [ ] svelte/action
- [ ] Directive: `<div contenteditable="true" bind:innerHTML={html}>`
- [ ] Directive: `<img bind:naturalWidth bind:naturalHeight></img>`
- [ ] Directive: `<div bind:this={element}>`
- [ ] Directive: `class:name`
- [ ] Directive: `style:property`
- [ ] Directive: `use:action`
- [ ] SpecialElements: `<svelte:window />`
- [ ] SpecialElements: `<svelte:document />`
- [ ] SpecialElements: `<svelte:body />`
- [ ] SpecialElements: `<svelte:options />`

## Not Support (in the near future)

- [ ] svelte: `getAllContexts()`
- [ ] Style: `:global`


## Prior Art

- https://github.com/amen-souissi/svelte-to-react-compiler

## LICENSE

MIT