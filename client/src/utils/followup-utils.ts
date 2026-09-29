import type { FollowupType } from '@shared/api.interface';

const followupTypeLabelMap: Record<string, string> = {
  phone: '电话',
  wechat: '微信',
  visit: '拜访',
  meeting: '面谈',
};

export function followupTypeLabel(type: FollowupType): string {
  return followupTypeLabelMap[type] || type;
}

export const followupTypeOptions: { value: string; label: string }[] = [
  { value: 'phone', label: '电话' },
  { value: 'wechat', label: '微信' },
  { value: 'visit', label: '拜访' },
  { value: 'meeting', label: '面谈' },
];
