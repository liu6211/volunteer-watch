import { Alert, Linking } from 'react-native';

/**
 * 志愿贵州的写操作在 App 里做不了。
 *
 * 实测结论（详见仓库 README）：
 *   1. POST /app/api/view.php 被站点拦掉，一律回「访问超时，请按Ctrl+F5…」。
 *      最小请求头、完整 Chrome 请求头（含 Sec-Fetch-*、sec-ch-ua）、
 *      附带 seid / token / __hash__ —— 全部被拦，无一例外。
 *   2. GET 能过 WAF，但这些写接口只读 POST body、不读查询参数：
 *      GET opp_join 带 job_id 仍回「请选择岗位」；
 *      GET do_reply 带 content 仍回「长度不能少于1个字符(0)」。
 *
 * 所以「提交数据」只能交给浏览器完成 —— 那里是站点认可的客户端。
 * 这里统一提供出口，不要在别处重复写文案。
 */

export const SITE_ORIGIN = 'https://gz.zhiyuanyun.com';

export const SITE_HINT =
  '志愿贵州会拦截 App 发出的提交请求，所以这一步需要到浏览器里完成。\n' +
  '浏览器里保持登录即可直接操作，完成后回到 App 下拉刷新就能看到最新状态。';

/** 在浏览器里打开站点的某个页面 */
export function openSite(path: string) {
  void Linking.openURL(`${SITE_ORIGIN}${path}`);
}

/**
 * 提交类操作失败时的统一提示。
 * @param title   标题，例如「报名未成功」
 * @param message 服务器/本地的说明
 * @param path    要打开的站点路径，例如 '/app/opp/opp.my.php'
 * @param label   按钮文字
 */
export function alertSiteFallback(
  title: string,
  message: string,
  path: string,
  label = '用浏览器打开'
) {
  Alert.alert(`${title}`, `${message}\n\n${SITE_HINT}`, [
    { text: '知道了', style: 'cancel' },
    { text: label, onPress: () => openSite(path) },
  ]);
}

/** 常用的几个页面 */
export const SITE_PATHS = {
  myProjects: '/app/opp/opp.my.php',
  myOrgs: '/app/org/org.my.php',
  oppView: (id: string) => `/app/opp/view.php?id=${encodeURIComponent(id)}`,
  orgView: (id: string) => `/app/org/view.php?id=${encodeURIComponent(id)}`,
};
