/**
 * 视觉规范 —— 液态玻璃（Liquid Glass）风格
 *
 * 设计要点：
 *   1. 背景是一层很淡的彩色渐变，玻璃面板盖在上面，模糊才有东西可糊
 *   2. 面板 = 半透明 + 高光描边 + 柔和阴影，而不是纯白实心卡片
 *   3. 圆角偏大（18~26），按钮用胶囊形
 *   4. 图标统一用扁平矢量图标（Ionicons），不用 emoji
 *
 * 安卓差异：
 *   - 真实模糊依赖 Android 12+，低版本会自动退化成半透明色块，
 *     所以每个玻璃面板都垫了一层底色，退化后依然好看
 *   - 阴影用 elevation，iOS 用 shadow*
 */

import { Platform } from 'react-native';

/** 背景渐变（三色，非常淡） */
export const bgGradient = ['#EFF4FA', '#E8EEF7', '#F3EFF8'] as const;

export const colors = {
  /* 兼容旧字段名 */
  bg: '#EFF4FA',
  card: 'rgba(255,255,255,0.58)',

  /* 玻璃 */
  glass: 'rgba(255,255,255,0.58)',
  glassStrong: 'rgba(255,255,255,0.76)',
  glassFaint: 'rgba(255,255,255,0.38)',
  /** 玻璃面板的高光描边 */
  glassBorder: 'rgba(255,255,255,0.85)',
  /** 玻璃面板的分隔线 */
  glassDivider: 'rgba(60,70,90,0.10)',

  /* 文字 */
  text: '#141A22',
  textDim: '#5B6675',
  textFaint: '#8C96A5',
  textOnAccent: '#FFFFFF',

  /* 主色 */
  primary: '#1E7A4C',
  primaryDim: 'rgba(30,122,76,0.13)',
  primaryBorder: 'rgba(30,122,76,0.28)',

  /* 语义色 */
  info: '#1A5FBF',
  infoDim: 'rgba(26,95,191,0.13)',
  warn: '#AF5518',
  warnDim: 'rgba(175,85,24,0.14)',
  danger: '#BC3A2C',
  dangerDim: 'rgba(188,58,44,0.13)',

  /* 中性 */
  border: 'rgba(60,70,90,0.12)',
  track: 'rgba(120,130,150,0.30)',
  /** 输入框底色 */
  field: 'rgba(255,255,255,0.62)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  pill: 999,
} as const;

/** 玻璃面板阴影：iOS 用柔和外阴影，安卓用 elevation */
export const glassShadow = Platform.select({
  ios: {
    shadowColor: '#2A3446',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 3 },
  default: {},
});

/** 胶囊按钮阴影（比面板重一点，做出浮起感） */
export const buttonShadow = Platform.select({
  ios: {
    shadowColor: '#1E7A4C',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 4 },
  default: {},
});

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
  if (/结项|结束|完成/.test(status)) return { fg: colors.textDim, bg: 'rgba(120,130,150,0.14)' };
  if (/取消|终止/.test(status)) return { fg: colors.danger, bg: colors.dangerDim };
  return { fg: colors.info, bg: colors.infoDim };
}
