import { isTauri } from './slack/source';

// macOS 通知與 dock 徽章。Tauri 裡用 notification 外掛；在瀏覽器（純前端開發）退回 Web Notification。
let permitted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permitted !== null) return permitted;
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    permitted = (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
  } else if ('Notification' in window) {
    permitted = Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted';
  } else permitted = false;
  return permitted;
}

export async function notify(title: string, body: string) {
  try {
    if (!(await ensurePermission())) return;
    if (isTauri()) {
      const n = await import('@tauri-apps/plugin-notification');
      n.sendNotification({ title, body });
    } else new Notification(title, { body });
  } catch (e) {
    console.warn('通知失敗', e);
  }
}

export async function setBadge(count: number) {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
  } catch (e) {
    console.warn('設定徽章失敗', e);
  }
}

export function appFocused(): boolean {
  return document.hasFocus() && document.visibilityState === 'visible';
}
