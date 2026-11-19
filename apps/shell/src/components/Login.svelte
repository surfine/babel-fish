<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { giveConsent, hasConsent } from '../lib/consent';

  let { onDemo, onConsent, canLogin }: { onDemo: () => void; onConsent: () => void; canLogin: boolean } = $props();

  let consented = $state(hasConsent());
  let understood = $state(false);

  function agree() {
    giveConsent();
    consented = true;
    onConsent();
  }
</script>

<div class="login">
  {#if !consented}
    <div class="login-card">
      <h1>登入 Slack 之前</h1>
      <p>Babel Fish 不是 Slack 官方的 App。它借用 Slack 網頁版的登入來讀你的訊息。請先讀完這幾點：</p>
      <ul class="risks">
        <li>這種登入方式可能違反 Slack 的使用條款。</li>
        <li>Slack 可能隨時讓這次登入失效。失效時要重新登入。</li>
        <li>Slack 可能跳出安全警示，並通知工作空間的管理員。</li>
        <li>要翻譯的訊息會送到你設定的 AI 服務。公司頻道能不能外送，請先確認。</li>
      </ul>
      <p>Babel Fish 預設是唯讀模式：只讀訊息，英文由你複製到 Slack 自己傳送。</p>
      <label class="agree"><input type="checkbox" bind:checked={understood} /> 我了解這些風險，並自行承擔</label>
      <div class="row">
        <button class="btn primary" onclick={agree} disabled={!understood}>同意並繼續</button>
        <button class="btn" onclick={onDemo}>先看示範</button>
      </div>
    </div>
  {:else}
    <div class="login-card">
      <h1>Babel Fish</h1>
      <p>在 Slack 官方的登入頁登入你自己的帳號。登入資料存在這台 Mac 的鑰匙圈，不會寫進檔案。</p>

      {#if app.authNote}<div class="err" role="alert">{app.authNote}</div>{/if}

      {#if app.loggingIn}
        <div class="waiting"><span class="spin"></span>在剛打開的視窗登入 Slack，登入好會自動回到這裡。</div>
      {/if}

      <div class="row">
        {#if app.authNote?.includes('沒有解鎖')}
          <button class="btn primary" onclick={onConsent}>再解鎖一次</button>
        {/if}
        <button class="btn" class:primary={!app.authNote?.includes('沒有解鎖')} onclick={() => app.login()} disabled={!canLogin || app.loggingIn}>
          {app.authNote?.includes('失效') ? '重新登入 Slack' : '登入 Slack'}
        </button>
        <button class="btn" onclick={onDemo}>先看示範</button>
        {#if !canLogin}<span class="as-who">瀏覽器裡只能看示範，登入要開 Babel Fish App</span>{/if}
      </div>
    </div>
  {/if}
</div>
