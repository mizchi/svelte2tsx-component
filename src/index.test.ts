import prettier from "prettier";
import { test, expect } from "vitest";
import { parse, svelteToReact } from ".";

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
    <span class="red">t1</span>
    <span class="raw">t2</span>
    <span class="red container">t3</span>
    <span class="red raw">t4</span>
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
  expect(formatted).toContain(`import { css } from "@linaria/core";`);
  expect(formatted).toContain(`<span className={selector$red}>t1</span>`);
  expect(formatted).toContain(`<span className="raw">t2</span>`);
  expect(formatted).toContain(`<span className={[selector$red, selector$container].join(" ")}>t3</span>`);
  expect(formatted).toContain(`<span className={[selector$red, "raw"].join(" ")}>t4</span>`);
  expect(formatted).toContain(`const selector$container = css\``);
  expect(formatted).toContain(`const selector$red = css\``);
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
