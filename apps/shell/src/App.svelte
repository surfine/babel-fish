<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/store.svelte';
  import { isTauri } from './lib/slack/source';
  import { TauriSource } from './lib/slack/tauri';
  import { DemoSource } from './lib/slack/demo';
  import Login from './components/Login.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Channel from './components/Channel.svelte';
  import ThreadPane from './components/ThreadPane.svelte';
  import Overlays from './components/Overlays.svelte';
  import { checkForUpdate } from './lib/updater.svelte';
  import { ui } from './lib/ui.svelte';
  import { listen } from '@tauri-apps/api/event';

  onMount(() => {
    const demo = new URLSearchParams(location.search).has('demo');
    if (demo) app.start(new DemoSource());
    else if (isTauri()) app.start(new TauriSource());
    else app.phase = 'login';
    checkForUpdate();
    // 選單列的 Rosetta › 設定…（⌘,）；設定面板在側欄裡，登入前沒有
    if (isTauri()) {
      const off = listen('menu://settings', () => {
        if (app.phase === 'ready') ui.settings = true;
      });
      return () => off.then((f) => f());
    }
  });

  function startDemo() {
    app.start(new DemoSource());
  }

  // 同意風險說明後才讀鑰匙圈裡的舊登入（有的話直接進去）
  function afterConsent() {
    if (isTauri()) app.start(new TauriSource());
  }
</script>

{#if app.phase === 'boot'}
  <div class="boot"><span class="spin"></span></div>
{:else if app.phase === 'login'}
  <Login onDemo={startDemo} onConsent={afterConsent} canLogin={isTauri()} />
{:else}
  <div class="app" class:with-thread={!!app.thread}>
    <Sidebar />
    <Channel />
    {#if app.thread}<ThreadPane />{/if}
  </div>
{/if}
<Overlays />
