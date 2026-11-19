// 時間與日期顯示（台灣用語）
export function tsDate(ts: string): Date {
  return new Date(Number(ts) * 1000);
}

export function timeLabel(ts: string): string {
  const d = tsDate(ts);
  const h = d.getHours();
  const part = h < 5 ? '凌晨' : h < 12 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
  return `${part} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

export function dayKey(ts: string): string {
  const d = tsDate(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(ts: string, now = new Date()): string {
  const d = tsDate(ts);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  const base = `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEK[d.getDay()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${d.getFullYear()} 年 ${base}`;
}

export function sizeLabel(n?: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
