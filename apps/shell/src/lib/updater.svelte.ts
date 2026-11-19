// 自動更新：只有發行版會註冊 updater（見 src-tauri/src/lib.rs），開發版與瀏覽器裡 check() 會失敗，直接略過。
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauri } from './slack/source';

export const updater = $state({
  available: null as { version: string } | null,
  installing: false,
  error: null as string | null,
});

let pending: Update | null = null;

export async function checkForUpdate() {
  if (!isTauri()) return;
  try {
    pending = await check();
    updater.available = pending ? { version: pending.version } : null;
  } catch {
    // 開發版沒有 updater，或連不上 GitHub：不打擾使用者
  }
}

export async function installUpdate() {
  if (!pending) return;
  updater.installing = true;
  updater.error = null;
  try {
    await pending.downloadAndInstall();
    await relaunch();
  } catch {
    updater.installing = false;
    updater.error = '更新沒有裝好。等一下再試，或到 GitHub 下載新版。';
  }
}
