# 前端依赖

本目录保存 Timeless 浏览器构建适配模块；公共静态资源统一保存在 `../public/`，由 `scripts/build.js` 复制，构建无需访问仓库外的文件。

AI 服务商图标保存在 `../public/provider-logos/`，同目录保留来源说明和许可证，对外路径为 `/provider-logos/`。

浏览器 Core / DOM 运行时统一保存在项目的 `public/assets/timeless/0.34.2/`；修改后运行 `npm run build`。

当前广场和后台共用 Timeless 0.34.2。`../public/assets/timeless/0.34.2/` 的 Core/DOM 来自 Timeless 根构建产物，`../public/assets/timeless/0.34.2/lite/` 与 `ssr/` 用于服务端及测试构建，并随静态资源一同发布。DOM 已同步上游源码中的 hydration 修复：使用实时 DOM 游标处理透明组件锚点，补建空文本节点，并拆分 HTML 合并的相邻文本；回归测试位于 Timeless 的 `packages/timeless-dom/src/__tests__/hydration.test.ts`。
