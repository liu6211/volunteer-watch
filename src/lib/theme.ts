/**
 * 统一的颜色与尺寸
 */
export const colors = {
  bg: '#F5F6F8',
  card: '#FFFFFF',
  border: '#E4E7EC',
  text: '#1A1D21',
  textDim: '#6B7280',
  textFaint: '#9CA3AF',
  primary: '#2E7D32',
  primaryDim: '#E8F5E9',
  danger: '#C62828',
  dangerDim: '#FDECEA',
  warn: '#E65100',
  warnDim: '#FFF3E0',
  info: '#1565C0',
  infoDim: '#E3F2FD',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
};

/** 把 ISO 时间格式化成「x 分钟前」这样的短文本 */
export function timeAgo(iso?: string): string {
  if (!iso) return '从未检查';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '时间未知';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString();
}

export function formatTime(iso?: string): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '-';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 项目状态对应的颜色 */
export function statusColor(status: string): { fg: string; bg: string } {
  if (/运行中|招募中|进行中/.test(status)) return { fg: colors.primary, bg: colors.primaryDim };
  if (/结项|结束|完成/.test(status)) return { fg: colors.textDim, bg: '#EEF0F3' };
  if (/取消|终止/.test(status)) return { fg: colors.danger, bg: colors.dangerDim };
  return { fg: colors.info, bg: colors.infoDim };
}
