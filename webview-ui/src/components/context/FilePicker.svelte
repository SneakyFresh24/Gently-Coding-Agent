<script lang="ts">
  import Button from '../ui/Button.svelte';
  import { messaging } from '../../lib/messaging';

  function handlePick() {
    messaging.send('openFilePicker');
  }
</script>

<Button variant="ghost" size="sm" onclick={handlePick} title="Attach files">
  📎 Add Files
</Button>
