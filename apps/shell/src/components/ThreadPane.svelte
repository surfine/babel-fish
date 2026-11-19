<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import MessageFeed from './MessageFeed.svelte';
  import Composer from './Composer.svelte';

  const t = $derived(app.thread!);
  const mode = $derived(app.modeOf(t.channel));
</script>

<aside class="thread" aria-label="對話串">
  <div class="th-head">
    <h3>對話串<small>{app.convLabel(t.channel)}</small></h3>
    <button class="icon-btn" aria-label="關閉對話串" onclick={() => app.closeThread()}>{@html ICON.close}</button>
  </div>
  {#key t.ts}
    <MessageFeed channel={t.channel} messages={app.threadMessages} scope="thread" threadTs={t.ts} {mode} />
    <Composer channel={t.channel} threadTs={t.ts} scope="thread" />
  {/key}
</aside>
