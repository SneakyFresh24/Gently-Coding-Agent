<script lang="ts">
  let {
    isHidden = false,
    children,
  }: {
    isHidden?: boolean;
    children?: any;
  } = $props();
</script>

<div class="chat-layout" class:hidden={isHidden}>
  {@render children?.()}
</div>

<style>
  .chat-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .chat-layout.hidden {
    display: none;
  }
</style>
