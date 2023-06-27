<script lang="ts">
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher<{
    message: {
      data: string;
    };
  }>();
  const x: number = 1;

  dispatch("message", {
    data: "hello",
  });
</script>

<div>
  xxx
</div>