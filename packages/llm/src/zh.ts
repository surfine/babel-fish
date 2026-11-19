/**
 * 中文的地區用字：台灣正體、香港繁體、大陸简体、马新简体。
 *
 * 翻譯、回譯、摘要、俚語說明與「為什麼這樣寫」都直接用使用者選的地區寫（交給模型），
 * 介面文字則由殼用同一張術語表加 OpenCC 轉換（見 apps/shell/src/lib/zh.ts）。
 *
 * 術語表 TERMS 是本專案自己整理的，做法參考 taiwan-md 的〈TERMINOLOGY〉（CC BY-SA 4.0，沒有搬它的內容）。
 * 只收字形轉換（OpenCC）處理不了、而且常出現在聊天或軟體介面的「用詞」差異。
 * 人看的版本是 docs/TERMINOLOGY.md，由 npm run terms 產生。
 */
export const ZH_VARIANTS = ['zh-TW', 'zh-HK', 'zh-CN', 'zh-SG'] as const;
export type ZhVariant = (typeof ZH_VARIANTS)[number];
export const DEFAULT_ZH: ZhVariant = 'zh-TW';

export const ZH_LABEL: Record<ZhVariant, string> = {
  'zh-TW': '台灣正體',
  'zh-HK': '香港繁體',
  'zh-CN': '大陆简体',
  'zh-SG': '马新简体',
};

export interface Term {
  tw: string;
  hk: string;
  cn: string;
  /** 新加坡與馬來西亞 */
  sg: string;
  topic: '科技' | '介面' | '工作' | '生活';
  note?: string;
}

const T = (topic: Term['topic'], tw: string, hk: string, cn: string, sg: string, note?: string): Term => ({ tw, hk, cn, sg, topic, ...(note ? { note } : {}) });

export const TERMS: Term[] = [
  T('科技', '軟體', '軟件', '软件', '软件'),
  T('科技', '硬體', '硬件', '硬件', '硬件'),
  T('科技', '記憶體', '記憶體', '内存', '内存'),
  T('科技', '作業系統', '操作系統', '操作系统', '操作系统'),
  T('科技', '資料', '數據', '数据', '数据', '指 data 時；「資料」在台灣也指一般的資料、文件'),
  T('科技', '資訊', '資訊', '信息', '资讯'),
  T('科技', '資料庫', '數據庫', '数据库', '数据库'),
  T('科技', '伺服器', '伺服器', '服务器', '服务器'),
  T('科技', '演算法', '算法', '算法', '算法'),
  T('科技', '程式碼', '程式碼', '代码', '代码'),
  T('科技', '程式', '程式', '程序', '程序'),
  T('科技', '應用程式', '應用程式', '应用程序', '应用程序'),
  T('科技', '網際網路', '互聯網', '互联网', '互联网'),
  T('科技', '網路', '網絡', '网络', '网络'),
  T('科技', '人工智慧', '人工智能', '人工智能', '人工智能'),
  T('科技', '晶片', '晶片', '芯片', '芯片'),
  T('科技', '硬碟', '硬碟', '硬盘', '硬盘'),
  T('科技', '寬頻', '寬頻', '宽带', '宽频'),
  T('科技', '解析度', '解像度', '分辨率', '分辨率'),
  T('科技', '行動裝置', '流動裝置', '移动设备', '移动设备'),
  T('科技', '筆電', '手提電腦', '笔记本电脑', '手提电脑'),
  T('科技', '相容', '兼容', '兼容', '兼容'),
  T('科技', '外掛', '插件', '插件', '插件'),
  T('科技', '最佳化', '優化', '优化', '优化'),
  T('科技', '影片', '影片', '视频', '视频'),
  T('科技', '部落格', '網誌', '博客', '博客'),
  T('科技', '按讚', '讚好', '点赞', '点赞'),
  T('介面', '使用者', '用戶', '用户', '用户'),
  T('介面', '帳號', '帳戶', '账号', '账号'),
  T('介面', '登入', '登入', '登录', '登录'),
  T('介面', '設定', '設定', '设置', '设置'),
  T('介面', '預設', '預設', '默认', '默认'),
  T('介面', '連結', '連結', '链接', '链接'),
  T('介面', '資料夾', '資料夾', '文件夹', '文件夹'),
  T('介面', '檔案', '檔案', '文件', '文件'),
  T('介面', '上傳', '上載', '上传', '上传'),
  T('介面', '複製', '複製', '复制', '复制', 'OpenCC 會轉成較舊的「拷贝」'),
  T('介面', '貼上', '貼上', '粘贴', '粘贴'),
  T('介面', '剪貼簿', '剪貼簿', '剪贴板', '剪贴板'),
  T('介面', '視窗', '視窗', '窗口', '窗口'),
  T('介面', '選單', '選單', '菜单', '菜单'),
  T('介面', '滑鼠', '滑鼠', '鼠标', '鼠标'),
  T('介面', '游標', '游標', '光标', '光标'),
  T('介面', '螢幕', '屏幕', '屏幕', '屏幕'),
  T('介面', '列印', '打印', '打印', '打印'),
  T('介面', '儲存', '儲存', '保存', '保存'),
  T('介面', '重新整理', '重新整理', '刷新', '刷新'),
  T('介面', '搜尋', '搜尋', '搜索', '搜索'),
  T('介面', '支援', '支援', '支持', '支持', '指相容、能用時'),
  T('介面', '訊息', '訊息', '消息', '讯息'),
  T('介面', '私訊', '私訊', '私信', '私信'),
  T('介面', '鑰匙圈', '鑰匙圈', '钥匙串', '钥匙串', 'macOS 的系統功能名稱'),
  T('介面', '金鑰', '密鑰', '密钥', '密钥', '指 API 金鑰'),
  T('介面', '唯讀', '唯讀', '只读', '只读'),
  T('介面', '工作空間', '工作空間', '工作区', '工作区', 'Slack 的 workspace'),
  T('介面', '傳送', '傳送', '发送', '发送', '送出訊息'),
  T('介面', '品質', '質素', '质量', '质量'),
  T('工作', '專案', '項目', '项目', '项目'),
  T('工作', '計畫', '計劃', '计划', '计划'),
  T('工作', '水準', '水平', '水平', '水平'),
  T('工作', '行銷', '市場推廣', '营销', '营销'),
  T('工作', '影印', '影印', '复印', '复印'),
  T('生活', '計程車', '的士', '出租车', '德士'),
  T('生活', '公車', '巴士', '公交车', '巴士'),
  T('生活', '捷運', '港鐵', '地铁', '地铁', '泛指都市軌道交通時'),
  T('生活', '機車', '電單車', '摩托车', '摩托车'),
  T('生活', '冰淇淋', '雪糕', '冰淇淋', '雪糕'),
  T('生活', '鳳梨', '菠蘿', '菠萝', '黄梨'),
  T('生活', '馬鈴薯', '薯仔', '土豆', '马铃薯'),
];

const COLUMN: Record<ZhVariant, keyof Pick<Term, 'tw' | 'hk' | 'cn' | 'sg'>> = { 'zh-TW': 'tw', 'zh-HK': 'hk', 'zh-CN': 'cn', 'zh-SG': 'sg' };

export const termIn = (t: Term, v: ZhVariant) => t[COLUMN[v]];

const DESCRIBE: Record<ZhVariant, string> = {
  'zh-TW': 'Traditional Chinese as written in Taiwan (台灣正體中文), with Taiwanese vocabulary; never Simplified characters or mainland terms',
  'zh-HK': 'Traditional Chinese as written in Hong Kong (香港繁體中文書面語), with Hong Kong vocabulary; standard written Chinese, not colloquial Cantonese, and never Simplified characters',
  'zh-CN': 'Simplified Chinese as written in mainland China (中国大陆简体中文), with mainland vocabulary; never Traditional characters',
  'zh-SG': 'Simplified Chinese as written in Singapore and Malaysia (新马简体华文), with local vocabulary; never Traditional characters',
};

/** 放進提示詞的語言說明，附上這個地區和其他地區用詞不同的例子。 */
export function zhInstruction(v: ZhVariant = DEFAULT_ZH, examples = 12): string {
  const pairs = TERMS.filter((t) => new Set([t.tw, t.hk, t.cn, t.sg]).size > 1)
    .slice(0, examples)
    .map((t) => {
      const mine = termIn(t, v);
      const others = [...new Set([t.tw, t.hk, t.cn, t.sg].filter((x) => x !== mine))];
      return `${mine} (not ${others.join('/')})`;
    });
  return `${DESCRIBE[v]}. Use this region's words, e.g. ${pairs.join(', ')}`;
}

/** 術語表的中文譯名預設是台灣寫法；其他地區用 zhVariants 覆蓋，沒有就請模型自己換成該地區的寫法。 */
export function glossaryZh(zh: string | null, overrides: Partial<Record<ZhVariant, string>> | undefined, v: ZhVariant): string | null {
  if (zh === null) return null;
  return overrides?.[v] ?? zh;
}
