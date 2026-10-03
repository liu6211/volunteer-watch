/**
 * 视觉规范 —— 液态玻璃（Liquid Glass）风格 + 深/浅色自适应
 *
 * 实现方式（关键）：
 *   colors 的属性是 getter，读的是模块级变量 palette。
 *   根布局在渲染时调用 applyScheme(scheme) 把 palette 切到当前模式；
 *   各页面的 StyleSheet 改成「工厂函数」并在组件内调用（useStyles），
 *   所以每次渲染都会用当前 palette 重新生成样式。
 *
 *   这样不用重构每个组件的写法，也能正确切换深浅色。
 *
 * 安卓差异：
 *   - 真实模糊依赖 Android 12+，低版本自动退化成半透明色块，
 *     所以每个玻璃面板都垫了一层底色，退化后依然好看
 *   - 阴影用 elevation，iOS 用 shadow*
 */

import { Platform, useColorScheme } from 'react-native';

export type Scheme = 'light' | 'dark';

type Palette = {
  bg: string;
  card: string;
  glass: string;
  glassStrong: string;
  glassFaint: string;
  glassBorder: string;
  glassDivider: string;
  text: string;
  textDim: string;
  textFaint: string;
  textOnAccent: string;
  primary: string;
  primaryDim: string;
  primaryBorder: string;
  info: string;
  infoDim: string;
  warn: string;
  warnDim: string;
  danger: string;
  dangerDim: string;
  border: string;
  track: string;
  field: string;
  /** 超链接/次要说明用的浅底 */
  subtle: string;
  gradient: readonly [string, string, string];
  /** BlurView 的材质：iOS 有专门的深浅材质 */
  blurTint: 'systemUltraThinMaterialLight' | 'systemUltraThinMaterialDark';
  shadowColor: string;
  shadowOpacity: number;
};

const LIGHT: Palette = {
  bg: '#EFF4FA',
  card: 'rgba(255,255,255,0.58)',

  glass: 'rgba(255,255,255,0.58)',
  glassStrong: 'rgba(255,255,255,0.76)',
  glassFaint: 'rgba(255,255,255,0.38)',
  glassBorder: 'rgba(255,255,255,0.85)',
  glassDivider: 'rgba(60,70,90,0.10)',

  text: '#141A22',
  textDim: '#5B6675',
  textFaint: '#8C96A5',
  textOnAccent: '#FFFFFF',

  primary: '#1E7A4C',
  primaryDim: 'rgba(30,122,76,0.13)',
  primaryBorder: 'rgba(30,122,76,0.28)',

  info: '#1A5FBF',
  infoDim: 'rgba(26,95,191,0.13)',
  warn: '#AF5518',
  warnDim: 'rgba(175,85,24,0.14)',
  danger: '#BC3A2C',
  dangerDim: 'rgba(188,58,44,0.13)',

  border: 'rgba(60,70,90,0.12)',
  track: 'rgba(120,130,150,0.30)',
  field: 'rgba(255,255,255,0.62)',
  subtle: 'rgba(255,255,255,0.50)',

  gradient: ['#EFF4FA', '#E8EEF7', '#F3EFF8'],
  blurTint: 'systemUltraThinMaterialLight',
  shadowColor: '#2A3446',
  shadowOpacity: 0.1,
};

const DARK: Palette = {
  bg: '#0E1116',
  card: 'rgba(30,35,45,0.55)',

  glass: 'rgba(30,35,45,0.55)',
  glassStrong: 'rgba(36,42,54,0.78)',
  glassFaint: 'rgba(30,35,45,0.36)',
  glassBorder: 'rgba(255,255,255,0.14)',
  glassDivider: 'rgba(255,255,255,0.09)',

  text: '#EDF1F7',
  textDim: '#A8B2C1',
  textFaint: '#78828F',
  textOnAccent: '#0B1A12',

  primary: '#4CC98A',
  primaryDim: 'rgba(76,201,138,0.18)',
  primaryBorder: 'rgba(76,201,138,0.34)',

  info: '#6BA8F5',
  infoDim: 'rgba(107,168,245,0.18)',
  warn: '#E8A05A',
  warnDim: 'rgba(232,160,90,0.18)',
  danger: '#F07A6C',
  dangerDim: 'rgba(240,122,108,0.18)',

  border: 'rgba(255,255,255,0.12)',
  track: 'rgba(160,170,190,0.35)',
  field: 'rgba(255,255,255,0.08)',
  subtle: 'rgba(255,255,255,0.07)',

  gradient: ['#0F1319', '#121722', '#15121C'],
  blurTint: 'systemUltraThinMaterialDark',
  shadowColor: '#000000',
  shadowOpacity: 0.45,
};

let current: Palette = LIGHT;
let currentScheme: Scheme = 'light';

/** 切换当前色板（由根布局在渲染时调用） */
export function applyScheme(scheme: Scheme | null | undefined): void {
  const next: Scheme = scheme === 'dark' ? 'dark' : 'light';
  if (next === currentScheme) return;
  currentScheme = next;
  current = next === 'dark' ? DARK : LIGHT;
}

export function getScheme(): Scheme {
  return currentScheme;
}

/**
 * 颜色对象：属性是 getter，永远读当前 palette。
 * 注意：只能在组件渲染期间/样式工厂里读取，不要缓存到模块级常量。
 */
export const colors = {
  get bg() { return current.bg; },
  get card() { return current.card; },
  get glass() { return current.glass; },
  get glassStrong() { return current.glassStrong; },
  get glassFaint() { return current.glassFaint; },
  get glassBorder() { return current.glassBorder; },
  get glassDivider() { return current.glassDivider; },
  get text() { return current.text; },
  get textDim() { return current.textDim; },
  get textFaint() { return current.textFaint; },
  get textOnAccent() { return current.textOnAccent; },
  get primary() { return current.primary; },
  get primaryDim() { return current.primaryDim; },
  get primaryBorder() { return current.primaryBorder; },
  get info() { return current.info; },
  get infoDim() { return current.infoDim; },
  get warn() { return current.warn; },
  get warnDim() { return current.warnDim; },
  get danger() { return current.danger; },
  get dangerDim() { return current.dangerDim; },
  get border() { return current.border; },
  get track() { return current.track; },
  get field() { return current.field; },
  get subtle() { return current.subtle; },
  get blurTint() { return current.blurTint; },
};

/** 背景渐变（getter，跟着深浅色走） */
export function bgGradient(): readonly [string, string, string] {
  return current.gradient;
}

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

/** 玻璃面板阴影 */
export function glassShadow() {
  return Platform.select({
    ios: {
      shadowColor: current.shadowColor,
      shadowOpacity: current.shadowOpacity,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 3 },
    default: {},
  });
}

/** 胶囊按钮阴影 */
export function buttonShadow() {
  return Platform.select({
    ios: {
      shadowColor: current.primary,
      shadowOpacity: currentScheme === 'dark' ? 0.35 : 0.28,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 4 },
    default: {},
  });
}

/**
 * 把 StyleSheet 包成「跟着当前色板自动重建」的对象。
 *
 * 原理：返回的对象每个属性都是 getter，读取时先检查色板有没有变，
 * 变了就重新调用 factory。这样各页面仍然可以写
 *   const styles = themedStyles(() => StyleSheet.create({ ... }));
 * 而不用在每个组件里加 hook。
 *
 * 配合根布局的 <View key={scheme}> —— 切换深浅色时整棵 UI 重新挂载，
 * 于是 getter 会读到新的色板值。
 */
export function themedStyles<T extends Record<string, unknown>>(factory: () => T): T {
  let built: T | null = null;
  let builtFor: Scheme | null = null;

  const ensure = (): T => {
    if (!built || builtFor !== currentScheme) {
      built = factory();
      builtFor = currentScheme;
    }
    return built;
  };

  const out: Record<string, unknown> = {};
  // 先构建一次拿到键名（键名与色板无关）
  for (const key of Object.keys(factory())) {
    Object.defineProperty(out, key, {
      get: () => ensure()[key],
      enumerable: true,
    });
  }
  return out as T;
}

/** 当前深浅色（给 StatusBar 等非样式场景用） */
export function useScheme(): Scheme {
  const s = useColorScheme();
  return s === 'dark' ? 'dark' : 'light';
}

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
  if (/结项|结束|完成/.test(status)) return { fg: colors.textDim, bg: 'rgba(120,130,150,0.16)' };
  if (/取消|终止/.test(status)) return { fg: colors.danger, bg: colors.dangerDim };
  return { fg: colors.info, bg: colors.infoDim };
}
