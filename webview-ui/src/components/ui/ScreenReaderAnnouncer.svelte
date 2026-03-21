<script lang="ts">
  let {
    message = '',
    politeness = 'polite',
  }: {
    message?: string;
    politeness?: 'polite' | 'assertive';
  } = $props();
</script>

<div class="sr-only" aria-live={politeness} aria-atomic="true">
  {message}
</div>
