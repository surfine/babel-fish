// 由 src/zh.ts 的 TERMS 產生 docs/TERMINOLOGY.md（人看的術語表）。npm run terms
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTermsDoc } from '../src/terms-doc.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/TERMINOLOGY.md');
writeFileSync(out, renderTermsDoc());
console.log(`已寫入 ${out}`);
