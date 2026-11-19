import { describe, expect, it } from 'vitest';
import { CONSENT_KEY, CONSENT_VERSION, giveConsent, hasConsent } from './consent';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('consent', () => {
  it('沒同意過就是 false，同意後是 true', () => {
    const s = mem();
    expect(hasConsent(s)).toBe(false);
    giveConsent(s, new Date('2026-11-19T00:00:00Z'));
    expect(hasConsent(s)).toBe(true);
    expect(JSON.parse(s.getItem(CONSENT_KEY)!)).toEqual({ version: CONSENT_VERSION, at: '2026-11-19T00:00:00.000Z' });
  });

  it('舊版本的同意或壞掉的值都要重新同意', () => {
    const s = mem();
    s.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION - 1 }));
    expect(hasConsent(s)).toBe(false);
    s.setItem(CONSENT_KEY, '{oops');
    expect(hasConsent(s)).toBe(false);
  });

  it('沒有 storage 時不算同意', () => {
    expect(hasConsent(null)).toBe(false);
  });
});
