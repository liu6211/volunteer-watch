import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * 从后台/其它 App 回到前台时执行回调。
 *
 * 为什么需要：所有「提交类」操作（报名、加入团体、取消报名、更换岗位、
 * 申请时长、评价、发评论）都改成跳浏览器完成了 —— 用户切出去做完事
 * 再切回来，App 里的数据其实已经变了，但界面还停着旧数据。
 * 手动下拉当然可以，只是容易忘。这里在切回前台时自动刷新一次。
 *
 * 回调放在 ref 里，避免每次渲染都重新订阅；也用 effect 写入，
 * 不在渲染期改 ref。
 */
export function useRefreshOnReturn(onReturn: () => void, enabled = true) {
  const cb = useRef(onReturn);

  useEffect(() => {
    cb.current = onReturn;
  }, [onReturn]);

  useEffect(() => {
    if (!enabled) return undefined;

    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      // 只在「从非激活 → 激活」的那一次触发，避免重复刷新
      if (prev !== 'active' && next === 'active') cb.current();
      prev = next;
    });
    return () => sub.remove();
  }, [enabled]);
}
