// 只給建置與測試用（Node）：OpenCC 的字形轉換器
import * as OpenCC from 'opencc-js';
import type { ZhVariant } from '@rosetta/llm';
import type { CharConverter } from './region';

export function charConverter(v: ZhVariant): CharConverter {
  if (v === 'zh-TW') return (s) => s;
  return v === 'zh-HK' ? OpenCC.Converter({ from: 'tw', to: 'hk' }) : OpenCC.Converter({ from: 'twp', to: 'cn' });
}
