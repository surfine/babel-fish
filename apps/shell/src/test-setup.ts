// 測試一律從台灣正體開始（Node 的 navigator.languages 是英文）；要測別的語言就在測試裡 setUserLangForTest
import { setUserLangForTest } from './lib/i18n';
setUserLangForTest('zh-TW');
