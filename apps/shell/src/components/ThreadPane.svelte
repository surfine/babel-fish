<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { ICON } from '../lib/icons';
  import { t } from '../lib/i18n';
  import MessageFeed from './MessageFeed.svelte';
  import Composer from './Composer.svelte';

  const th = $derived(app.thread!);
  const mode = $derived(app.modeOf(th.channel));
</script>

<aside class="thread" aria-label={t('對話串')}>
  <div class="th-head">
    <h3>{t('對話串')}<small data-raw>{app.convLabel(th.channel)}</small></h3>
    <button class="icon-btn" aria-label={t('關閉對話串')} onclick={() => app.closeThread()}>{@html ICON.close}</button>
  </div>
  {#key th.ts}
    <MessageFeed channel={th.channel} messages={app.threadMessages} scope="thread" threadTs={th.ts} {mode} />
    <Composer channel={th.channel} threadTs={th.ts} scope="thread" />
  {/key}
</aside>
