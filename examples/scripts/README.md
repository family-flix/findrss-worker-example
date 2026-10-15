# 脚本示例

17 个脚本使用全局 `RSSScript` 和 `import { utils } from '@findrss/util'`，接口请求、JSON 解析和校验返回 `Result`。仅原 `examples/scripts` 文件顶部有 `/** RSS */` 标记的文件放在此目录，原文件保留。

复制单个 `.js` 到管理后台 `/admin/scripts` 的 RSS Tab，可保存草稿、运行 Debug，确认后发布。同一主路由可用 `/rss/<path>` 或 `/atom/<path>` 获取订阅。章节正文等附加路由仍返回 HTML。

`zhihu_user.js` 导出 8 条独立路由，以下路径均带 `/zhihu` 前缀：

| 路径 | 内容 |
| --- | --- |
| `/people/:user_id` | 用户动态 |
| `/people/:user_id/answers` | 回答 |
| `/people/:user_id/zvideos` | 视频 |
| `/people/:user_id/asks` | 提问 |
| `/people/:user_id/posts` | 文章 |
| `/column/:column_id` | 专栏 |
| `/people/:user_id/pins` | 想法 |
| `/collection/:collection_id` | 收藏夹 |

例如 `/rss/zhihu/people/zhihu/answers`；用户参数统一为 `user_id`，不再提供可选 `kind` 路由。无后缀的用户入口读取动态，原回答订阅需使用 `/answers`。每次读取最新 20 条；专栏和收藏夹支持混合内容，想法保留文字和图片。登录 Cookie 按 `www.zhihu.com`、`zhuanlan.zhihu.com`、`api.zhihu.com` 分别声明权限。已有后台脚本需替换并重新确认 Cookie 授权后发布。旧 `examples/scripts/zhihu_user.js` 保留迁移前版本。

`fetch(ctx)` 返回 `Result<feed>`，`route.handler` 调用实例 `run(ctx)`。基类校验稳定 ID、标题和原文链接，按真实发布时间倒序并去重；缺失时间不补采集时间，只有相对日期文本时保留在描述中。正文、多图、视频附件、解密 key 和动态照片保留，RSS 关注文章内容与发布时间。

依赖登录的脚本在 `permissions.cookies` 中明确声明来源、Cookie 名称和用途，显式调用 `ctx.cookies.get` 获取本次执行的句柄，再传入请求；源码变化后需重新确认授权。日志演示抓取、解析与媒体处理，不记录凭证或账户页面正文。

示例不会自动导入后台。Worker 的 `test/script_examples_migration.test.js` 用生产 QuickJS 和模拟回包验证路由、排序、正文代理、RSS/Atom 渲染及媒体；未验证所有站点当前在线接口及实际登录态。SDK 仅适用于 Worker QuickJS，Go/goja 暂不支持。
