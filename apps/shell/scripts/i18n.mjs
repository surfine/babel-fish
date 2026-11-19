#!/usr/bin/env node
// 介面文字的抽取與檢查。原文（鍵）是台灣正體，寫在程式裡：
//   前端 t('…')，Rust tr("…")／trf("…", …)。
// 英文目錄手寫在 src/lib/i18n/en.ts；香港、大陆、马新的目錄在建置時產生（vite 外掛）。
//
//   node scripts/i18n.mjs          列出缺英文的鍵、英文目錄裡沒人用的鍵、還沒包進 t() 的中文
//   node scripts/i18n.mjs --stub   把缺的鍵加到 en.ts 尾端（值留空，等人填）
//
// 測試（src/lib/i18n/i18n.test.ts）用同一份函式，發現問題就失敗。
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SHELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'target' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

// 字串常值：'…'、"…"、不含 ${ 的 `…`
const LIT = String.raw`(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|\`((?:\\.|[^\`\\$])*)\`)`;
const T_CALL = new RegExp(String.raw`(?<![\w.$])t\(\s*` + LIT, 'g');
const RS_CALL = /\btrf?\(\s*"((?:\\.|[^"\\])*)"/g;

const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\(['"`\\])/g, '$1');

/** 前端原始碼（不含測試與目錄檔本身；i18n/index.ts 裡的 t() 要算） */
export function uiFiles(root = SHELL) {
  const i18nDir = join('src', 'lib', 'i18n');
  return walk(join(root, 'src'), ['.ts', '.svelte']).filter((f) => !f.endsWith('.test.ts') && (!f.includes(i18nDir) || f.endsWith(join(i18nDir, 'index.ts'))));
}

/** 前端原始碼去掉區塊註解與整行的 // 註解（註解裡舉例的 t('…') 不算） */
function uiSource(f) {
  return readFileSync(f, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Rust 原始碼去掉測試模組與 // 註解 */
function rustSource(f) {
  return readFileSync(f, 'utf8')
    .split(/#\[cfg\(test\)\]/)[0]
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/[^"]*$/, ''))
    .join('\n');
}

export function rustFiles(root = SHELL) {
  return walk(join(root, 'src-tauri', 'src'), ['.rs']);
}

/** 抽出所有鍵：ui 給前端目錄，rust 是 Rust 要的那些（前端啟動時把譯好的傳給 Rust） */
export function extractKeys(root = SHELL) {
  const ui = new Set();
  const rust = new Set();
  for (const f of uiFiles(root)) for (const m of uiSource(f).matchAll(T_CALL)) ui.add(unescape(m[1] ?? m[2] ?? m[3]));
  for (const f of rustFiles(root)) {
    // 測試模組與註解裡的字串不算
    const src = rustSource(f);
    for (const m of src.matchAll(RS_CALL)) rust.add(m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
  }
  return { ui, rust, all: new Set([...ui, ...rust]) };
}

/** 示範資料裡含中文的字串常值（給建置時產生各地區版本） */
export function demoStrings(root = SHELL) {
  const out = new Set();
  const src = readFileSync(join(root, 'src', 'lib', 'demo', 'data.ts'), 'utf8');
  for (const m of src.matchAll(new RegExp(LIT, 'g'))) {
    const s = unescape(m[1] ?? m[2] ?? m[3]);
    if (CJK.test(s)) out.add(s);
  }
  return out;
}

/** 去掉註解、t() 呼叫與標了 i18n-ignore 的行後，還含中文的地方就是漏包的介面文字 */
export function findUnwrapped(root = SHELL) {
  const found = [];
  // 示範資料是對話內容（虛構的人寫的訊息），不是介面文字
  const skip = (f) => f.includes(join('lib', 'demo')) || f.endsWith(join('translate', 'glossary.ts'));
  for (const f of uiFiles(root).filter((x) => !skip(x))) {
    let src = readFileSync(f, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    src.split('\n').forEach((line, i) => {
      if (line.includes('i18n-ignore')) return;
      const code = line
        .replace(/(^|[^:'"`\\])\/\/.*$/, '$1') // 行尾註解（不吃掉網址的 //）
        .replace(T_CALL, '')
        .replace(/console\.\w+\(.*\)/, '');
      if (CJK.test(code)) found.push({ file: relative(root, f), line: i + 1, text: line.trim() });
    });
  }
  for (const f of rustFiles(root)) {
    const raw = readFileSync(f, 'utf8');
    // 整個檔案自己處理各語言（例如 menu.rs 照各地區 macOS 的選單用語手寫）
    if (raw.includes('i18n-ignore-file')) continue;
    const lines = rustSource(f).split('\n');
    lines.forEach((line, i) => {
      if (line.includes('i18n-ignore')) return;
      const code = line.replace(/\/\/.*$/, '').replace(/\btrf?\(\s*"(?:\\.|[^"\\])*"/g, '');
      // 只看字串常值裡的中文
      if (/"[^"]*[\u3400-\u9fff][^"]*"/.test(code)) found.push({ file: relative(root, f), line: i + 1, text: line.trim() });
    });
  }
  return found;
}

/** {name} 形式的參數 */
export const placeholders = (s) => [...new Set([...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1]))].sort();

/** 英文目錄（Node 24 可以直接 import 只含可抹除型別的 .ts） */
export async function loadEnglish(root = SHELL) {
  return (await import(pathToFileURL(join(root, 'src', 'lib', 'i18n', 'en.ts')).href)).default;
}

export async function report(root = SHELL) {
  const { all } = extractKeys(root);
  const en = await loadEnglish(root);
  const missing = [...all].filter((k) => !en[k]);
  const unused = Object.keys(en).filter((k) => !all.has(k));
  const badParams = [...all].filter((k) => en[k] && placeholders(k).join() !== placeholders(en[k]).join());
  return { keys: all.size, missing, unused, badParams, unwrapped: findUnwrapped(root) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await report();
  console.log(`鍵 ${r.keys} 個`);
  const show = (title, list, fmt = (x) => x) => list.length && console.log(`\n${title}（${list.length}）\n` + list.map((x) => '  ' + fmt(x)).join('\n'));
  show('缺英文', r.missing);
  show('英文目錄裡沒人用', r.unused);
  show('參數和原文不一致', r.badParams);
  show('還沒包進 t()／tr() 的中文', r.unwrapped, (u) => `${u.file}:${u.line}  ${u.text}`);
  if (process.argv.includes('--stub') && r.missing.length) {
    const p = join(SHELL, 'src', 'lib', 'i18n', 'en.ts');
    const src = readFileSync(p, 'utf8');
    const add = r.missing.map((k) => `  ${JSON.stringify(k)}: "",`).join('\n');
    writeFileSync(p, src.replace(/\n};\s*$/, `\n${add}\n};\n`));
    console.log(`\n已把 ${r.missing.length} 個鍵加到 en.ts，值待填`);
  }
  if (r.missing.length || r.unused.length || r.badParams.length || r.unwrapped.length) process.exitCode = 1;
}
