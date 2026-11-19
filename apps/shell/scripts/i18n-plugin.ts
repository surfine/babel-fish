// vite 外掛：建置時由原始碼裡的 t()／tr() 抽出鍵，用術語表＋OpenCC 產生香港、大陆、马新的目錄，
// 以虛擬模組 virtual:i18n 提供給前端。英文目錄是手寫的 src/lib/i18n/en.ts，不在這裡產生。
import type { Plugin } from 'vite';
import type { ZhVariant } from '@rosetta/llm';
import { demoStrings, extractKeys } from './i18n.mjs';
import { generateCatalog } from '../src/lib/i18n/region';
import { charConverter } from '../src/lib/i18n/opencc';
import { OVERRIDES } from '../src/lib/i18n/overrides';

const ID = 'virtual:i18n';
const RESOLVED = '\0' + ID;
export const GENERATED: Exclude<ZhVariant, 'zh-TW'>[] = ['zh-HK', 'zh-CN', 'zh-SG'];

export function buildRegions() {
  const { all, rust } = extractKeys();
  const regions = Object.fromEntries(GENERATED.map((v) => [v, generateCatalog(all, v, charConverter(v), OVERRIDES[v])]));
  // 示範資料預寫的中文（譯文、回譯、說明）也換成各地區的寫法
  const demoTexts = demoStrings();
  const demo = Object.fromEntries(GENERATED.map((v) => [v, generateCatalog(demoTexts, v, charConverter(v))]));
  return { regions, demo, rustKeys: [...rust].sort() };
}

export function i18n(): Plugin {
  return {
    name: 'babel-fish-i18n',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load(id) {
      if (id !== RESOLVED) return;
      const { regions, demo, rustKeys } = buildRegions();
      return `export const regions = ${JSON.stringify(regions)};\nexport const demo = ${JSON.stringify(demo)};\nexport const rustKeys = ${JSON.stringify(rustKeys)};\n`;
    },
    // 開發時改了任何原始碼就重新抽取（新加的 t() 也有地區版本）
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (!/\.(svelte|ts|rs)$/.test(file) || file.includes('node_modules')) return;
        const m = server.moduleGraph.getModuleById(RESOLVED);
        if (m) server.moduleGraph.invalidateModule(m);
      });
    },
  };
}
