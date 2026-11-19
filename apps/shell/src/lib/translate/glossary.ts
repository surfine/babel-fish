import type { GlossaryEntry } from './types';

// 翻譯與潤色共用的術語表；產品名一律照 Apple 官方寫法
export const GLOSSARY: GlossaryEntry[] = [
  { term: 'Find My', zh: '「尋找」' },
  { term: 'Precision Finding', zh: '精確尋找' },
  { term: 'Control Center', zh: '控制中心' },
  { term: 'Siri Remote', zh: null },
  { term: 'AirPods Pro', zh: null },
  { term: 'tvOS 27、iPadOS 27、iOS 27', zh: null, note: '保留大小寫' },
];
