import type { ContactTier } from '@shared/api.interface';

export const tierLabelMap: Record<ContactTier, string> = {
  S: 'S类',
  A: 'A类',
  B: 'B类',
  C: 'C类',
  D: 'D类',
  V: 'V类',
};

export const tierColorMap: Record<ContactTier, { dot: string; badge: string; text: string }> = {
  S: {
    dot: 'bg-amber-700',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
    text: 'text-amber-700',
  },
  A: {
    dot: 'bg-red-600',
    badge: 'bg-red-50 text-red-600 border-red-200',
    text: 'text-red-600',
  },
  B: {
    dot: 'bg-amber-600',
    badge: 'bg-amber-50 text-amber-600 border-amber-200',
    text: 'text-amber-600',
  },
  C: {
    dot: 'bg-blue-600',
    badge: 'bg-blue-50 text-blue-600 border-blue-200',
    text: 'text-blue-600',
  },
  D: {
    dot: 'bg-slate-500',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    text: 'text-slate-500',
  },
  V: {
    dot: 'bg-green-600',
    badge: 'bg-green-50 text-green-600 border-green-200',
    text: 'text-green-600',
  },
};

/** 层级完整说明：只在需要解释跟进节奏的地方使用（如帮助/提示），界面标签一律用短文案 */
export const tierDescMap: Record<ContactTier, string> = {
  S: '成交高价值/节点客户，每季度维护 1 次',
  A: '高意向客户，每周跟进 1 次',
  B: '已接触客户，每 2 周跟进 1 次',
  C: '信息完整客户，每月联系 1 次',
  D: '线索客户，每 2 周联系 1 次',
  V: '普通已成交客户，售后维护',
};

/** 界面标签（筛选 chips / 下拉选项）：短文案，不带括号注释 */
export const tierOptions: { value: ContactTier | ''; label: string }[] = [
  { value: '', label: '全部层级' },
  { value: 'S', label: 'S 高价值' },
  { value: 'A', label: 'A 高意向' },
  { value: 'B', label: 'B 已接触' },
  { value: 'C', label: 'C 信息完整' },
  { value: 'D', label: 'D 线索' },
  { value: 'V', label: 'V 已成交' },
];
