// 時間與日期顯示：中文照台灣的說法（其他地區由目錄轉換），英文用 Intl
import { t, userLang } from './i18n';
export function tsDate(ts: string): Date {
  return new Date(Number(ts) * 1000);
}

export function timeLabel(ts: string): string {
  const d = tsDate(ts);
  if (userLang() === 'en') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const h = d.getHours();
  const part = h < 5 ? t('凌晨') : h < 12 ? t('早上') : h < 13 ? t('中午') : h < 18 ? t('下午') : t('晚上');
  return `${part} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEK = () => [t('週日'), t('週一'), t('週二'), t('週三'), t('週四'), t('週五'), t('週六')];

export function dayKey(ts: string): string {
  const d = tsDate(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ts: string, now = new Date()): string {
  const d = tsDate(ts);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return t('今天');
  if (diff === 1) return t('昨天');
  if (userLang() === 'en') {
    const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-US', opts);
  }
  const base = t('{month} 月 {day} 日 {weekday}', { month: d.getMonth() + 1, day: d.getDate(), weekday: WEEK()[d.getDay()] });
  return d.getFullYear() === now.getFullYear() ? base : t('{year} 年 {date}', { year: d.getFullYear(), date: base });
}

export function sizeLabel(n?: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
