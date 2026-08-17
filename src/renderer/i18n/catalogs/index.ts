import { en } from './en';
import { zhCN } from './zh-CN';

export const catalogs = {
  'zh-CN': zhCN,
  en,
} as const;

export type { ZhCNMessages } from './zh-CN';
