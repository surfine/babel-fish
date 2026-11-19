// 首次使用的風險同意：記在 localStorage，版本號變了（風險說明改了）就要重新同意。
export const CONSENT_KEY = 'rosetta.consent';
export const CONSENT_VERSION = 1;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function hasConsent(s: Store | null = storage()): boolean {
  try {
    const v = JSON.parse(s?.getItem(CONSENT_KEY) ?? 'null');
    return v?.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function giveConsent(s: Store | null = storage(), now = new Date()): void {
  s?.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, at: now.toISOString() }));
}
