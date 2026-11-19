<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { GLOSSARY, llmStatus, setLlmKey, type LlmProviderId } from '../lib/translate';
  import SkipLangs from './SkipLangs.svelte';
  import { LANGS, LANG_NATIVE, glossaryZh, isZh, type Lang } from '@rosetta/llm';
  import { saveUserLang, t, userLang } from '../lib/i18n';

  const lang = userLang();
  // 換語言要重新載入：介面目錄在啟動時選定，記憶體裡的譯文也要用新語言重翻
  function changeLang(l: Lang) {
    if (l === lang) return;
    saveUserLang(l);
    location.reload();
  }

  let { onclose }: { onclose: () => void } = $props();

  const ROWS: { id: LlmProviderId; name: string; use: string; placeholder: string }[] = [
    { id: 'anthropic', name: t('Anthropic（Claude）'), use: t('潤色、回譯、意思比對'), placeholder: 'sk-ant-…' },
    { id: 'deepseek', name: 'DeepSeek', use: t('逐則翻譯、俚語、未讀摘要'), placeholder: 'sk-…' },
  ];

  let values = $state<Record<LlmProviderId, string>>({ anthropic: '', deepseek: '' });
  let busy = $state<LlmProviderId | null>(null);

  const modeText = $derived(
    llmStatus.fake
      ? t('還沒填金鑰，翻譯和潤色只是示範')
      : llmStatus.keys.anthropic && llmStatus.keys.deepseek
        ? t('翻譯用 DeepSeek，潤色與檢查用 Claude')
        : llmStatus.keys.anthropic
          ? t('只有 Claude 金鑰：所有步驟都用 Claude')
          : t('只有 DeepSeek 金鑰：所有步驟都用 DeepSeek'),
  );

  async function save(id: LlmProviderId, key: string | null) {
    busy = id;
    try {
      await setLlmKey(id, key);
      values[id] = '';
      app.toast(key ? t('金鑰已存進鑰匙圈') : t('金鑰已刪除'));
    } catch (e) {
      app.toast(t('存金鑰失敗：{error}', { error: String((e as { message?: string })?.message ?? e) }));
    } finally {
      busy = null;
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="llm-title" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <div class="head">
    <h4 id="llm-title">{t('設定')}</h4>
    <button class="link-btn" onclick={onclose}>{t('關閉')}</button>
  </div>
  <div class="slack-sec">
    <label class="ro">
      <input type="checkbox" checked={app.readOnly} onchange={(e) => app.setReadOnly((e.currentTarget as HTMLInputElement).checked)} />
      <b>{t('唯讀模式')}</b>
    </label>
    <small>{t('Babel Fish 只讀訊息，回覆複製後到官方 Slack 自己傳送。關掉後可以直接在 Babel Fish 傳送、修改、刪除、加表情回應和上傳檔案。')}</small>
    {#if app.readOnly}
      <label class="ro">
        <input type="checkbox" checked={app.guidePref.enabled} onchange={(e) => app.setGuideEnabled((e.currentTarget as HTMLInputElement).checked)} />
        <b>{t('打開 Slack 後顯示貼上提示')}</b>
      </label>
    {/if}
  </div>
  <p class="sub">{t('金鑰存在這台 Mac 的鑰匙圈，只在呼叫 AI 服務時取用。')}</p>
  <p class="mode">{modeText}</p>
  {#each ROWS as r (r.id)}
    <div class="row">
      <div class="lbl">
        <b>{r.name}</b>
        <span class="state" class:on={llmStatus.keys[r.id]}>{llmStatus.keys[r.id] ? t('已設定') : t('未設定')}</span>
        <small>{r.use}</small>
      </div>
      <form class="field" onsubmit={(e) => { e.preventDefault(); if (values[r.id].trim()) save(r.id, values[r.id]); }}>
        <input type="password" autocomplete="off" spellcheck="false" placeholder={llmStatus.keys[r.id] ? t('貼上新金鑰會取代舊的') : r.placeholder} bind:value={values[r.id]} aria-label={t('{name} API 金鑰', { name: r.name })} />
        <button class="btn primary" type="submit" disabled={!values[r.id].trim() || busy === r.id}>{t('儲存')}</button>
        {#if llmStatus.keys[r.id]}
          <button class="btn" type="button" disabled={busy === r.id} onclick={() => save(r.id, null)}>{t('刪除')}</button>
        {/if}
      </form>
    </div>
  {/each}
  <div class="row">
    <div class="lbl"><label for="user-lang"><b>{t('我的語言')}</b></label><small>{t('介面、譯文、說明和回譯都用這個語言；別的語言的訊息會翻成它。換了會重新載入')}</small></div>
    <select id="user-lang" class="zh-select" value={lang} onchange={(e) => changeLang((e.currentTarget as HTMLSelectElement).value as Lang)}>
      {#each LANGS as l (l)}<option value={l}>{LANG_NATIVE[l]}</option>{/each}
    </select>
  </div>
  <div class="row">
    <div class="lbl"><b>{t('不翻譯的語言')}</b><small>{t('你看得懂的語言就不翻，省錢也比較快')}</small></div>
    <SkipLangs />
  </div>
  <details class="row">
    <summary class="lbl"><b>{t('術語表')}</b><small>{t('翻譯與潤色都照這張表；產品名保留官方寫法')}</small></summary>
    <table class="gloss">
      <tbody>
        {#each GLOSSARY as g (g.term)}<tr><td>{g.term}</td><td>{(isZh(lang) ? glossaryZh(g.zh, g.zhVariants, lang) : g.zh) ?? t('不翻譯')}</td></tr>{/each}
      </tbody>
    </table>
  </details>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.32); z-index: 80; }
  .sheet {
    position: fixed; z-index: 81; left: 50%; top: 14vh; transform: translateX(-50%);
    width: min(520px, calc(100vw - 32px)); background: var(--bg); color: var(--text);
    border: 1px solid var(--line-2); border-radius: 14px; box-shadow: var(--shadow); padding: 16px 18px 18px; outline: none;
  }
  .head { display: flex; justify-content: space-between; align-items: center; }
  h4 { margin: 0; font-size: 15px; }
  .slack-sec { margin: 10px 0 4px; padding-bottom: 12px; border-bottom: 1px solid var(--line); font-size: 13px; }
  .slack-sec small { display: block; margin-top: 4px; color: var(--text-3); font-size: 12px; }
  .zh-select { font: inherit; font-size: 14px; padding: 4px 8px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--bg); color: var(--text); }
  .ro { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .ro + small + .ro { margin-top: 12px; }
  .ro input { flex: none; accent-color: var(--accent); }
  .sub { margin: 4px 0 8px; color: var(--text-3); font-size: 12px; }
  /* 狀態說明不是連結，不用強調色（強調色只給可以按的東西） */
  .mode { margin: 0 0 12px; font-size: 13px; color: var(--text-2); }
  .row { padding-top: 16px; }
  .lbl { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; }
  .lbl small { color: var(--text-3); font-size: 12px; width: 100%; }
  .state { font-size: 12px; color: var(--text-3); }
  .state.on { color: var(--ok); }
  .field { display: flex; gap: 8px; }
  input {
    flex: 1; min-width: 0; border: 1px solid var(--line-2); border-radius: 8px; padding: 6px 10px;
    background: var(--bg); color: var(--text); font: 13px var(--font); outline: none;
  }
  input:focus { border-color: var(--accent-line); }
</style>
