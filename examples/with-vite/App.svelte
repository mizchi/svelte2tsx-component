<script lang="ts">
  import { createEventDispatcher } from "svelte";
  export let name: string;
  const dispatch = createEventDispatcher<{
    message: {
      data: string;
    };
  }>();
  let counter = 0;

  const onClickMessage = () => {
    dispatch("message", {
      data: "hello",
    });
  };

  const onClickCounter = () => {
    counter = counter + 1;
  };

</script>

<div>
  <span class="red">
    Hello, {name}!
  </span>
  <div>
    <button on:click={onClickMessage}>Message</button>
  </div>

  <div>
    Counter: {counter}
    <button on:click={onClickCounter}>++</button>
  </div>

</div>

<style>
  .red {
    color: red;
  }
</style>