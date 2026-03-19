<script lang="ts">
  let {
    name,
    size = 16,
    className = '',
  }: {
    name: string;
    size?: number;
    className?: string;
  } = $props();
</script>

<span
  class="codicon codicon-{name} {className}"
  style="font-size: {size}px; width: {size}px; height: {size}px;"
  aria-hidden="true"
></span>

<style>
  .codicon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
</style>
