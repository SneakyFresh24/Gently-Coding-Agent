<script lang="ts">
  import { onDestroy } from 'svelte';

  let {
    text = '',
    speed = 15,
    enabled = true,
  }: {
    text?: string;
    speed?: number;
    enabled?: boolean;
  } = $props();

  let rendered = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function animate(target: string) {
    clearTimer();
    if (!enabled) {
      rendered = target;
      return;
    }
    rendered = '';
    let index = 0;
    const tick = () => {
      rendered = target.slice(0, index + 1);
      index += 1;
      if (index < target.length) {
        timer = setTimeout(tick, speed);
      }
    };
    timer = setTimeout(tick, speed);
  }

  $effect(() => {
    animate(text);
  });

  onDestroy(() => {
    clearTimer();
  });
</script>

<span>{rendered}</span>

