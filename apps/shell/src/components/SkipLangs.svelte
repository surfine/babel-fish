<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { langLabels, type LangCode } from '../lib/lang';
  import { t } from '../lib/i18n';

  const LANGS = Object.entries(langLabels()) as [Exclude<LangCode, 'unknown'>, string][];

  function toggle(code: LangCode, on: boolean) {
    app.setSkipLangs(on ? [...app.skipLangs, code] : app.skipLangs.filter((l) => l !== code));
  }
</script>

<div class="skip" role="group" aria-label={t('不翻譯的語言')}>
  {#each LANGS as [code, label] (code)}
    <label><input type="checkbox" checked={app.skipLangs.includes(code)} onchange={(e) => toggle(code, e.currentTarget.checked)} />{label}</label>
  {/each}
</div>

<style>
  .skip { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--text-2); }
  label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
  input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
</style>
