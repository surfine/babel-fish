declare module 'virtual:i18n' {
  export const regions: Record<'zh-HK' | 'zh-CN' | 'zh-SG', Record<string, string>>;
  export const rustKeys: string[];
  export const demo: Record<'zh-HK' | 'zh-CN' | 'zh-SG', Record<string, string>>;
}
