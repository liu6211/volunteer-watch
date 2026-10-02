/**
 * 后台任务入口（类型与默认实现转发）
 *
 * 为什么要这个文件：
 *   - Metro 按平台自动选择实现：
 *       iOS / Android -> backgroundTask.native.ts
 *       web           -> backgroundTask.web.ts
 *   - 但 TypeScript 不会自动解析 `.native.ts`，找不到 './backgroundTask'。
 *     所以这里放一个转发文件，让类型检查有东西可解析。
 *   - web 打包时 Metro 优先选中 backgroundTask.web.ts，
 *     不会走到这个文件里转发的原生实现。
 */
export * from './backgroundTask.native';