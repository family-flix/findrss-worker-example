# 脚本示例

本目录的 RSS 脚本使用全局 `RSSScript` 和 `import { utils } from '@findrss/util'`，接口请求、JSON 解析和校验返回 `Result`。

每个脚本通过 `export const platform = { name, icon }` 声明平台，`icon` 已直接内嵌对应的 SVG 源码；多路由共用此对象，也可用 `route.platform` 覆盖。正式版本发布成功后才收集平台到数据库，供订阅广场与后台平台筛选 Select 使用，保存草稿和 Debug 不注册平台。

可用 `export const tags = ['科技', '文章']` 声明共用标签，或用 `route.tags` 逐条覆盖（`[]` 表示无标签）。每条路由最多 13 个不同标签，每个为去除首尾空白后的 1–32 字符且不含控制字符。正式发布后聚合为 discover 和后台的可选标签，新建自有源时按匹配路由预填，可手动修改；草稿和 Debug 不注册标签。标签属于脚本元数据，不是 handler 返回的 feed 字段。

复制单个 `.js` 到管理后台 `/admin/scripts` 的 RSS Tab，可保存草稿、运行 Debug，确认后发布。同一主路由可用 `/rss/<path>` 或 `/atom/<path>` 获取订阅。章节正文等附加路由仍返回 HTML。

`rss/apple.js` 参考 RSSHub 的 Apple Apps 路由，订阅 App Store 应用的版本更新。例如 `/rss/apple/apps/update/us/id408709785`；末尾可添加 `/ios`、`/macos`、`/tvos` 筛选平台，缺省或 `all` 合并全部平台，不支持的平台也按上游逻辑回退为全部平台。`?limit=100` 控制返回数量（1–1000，默认 100）。应用 ID 支持带 `id` 前缀或纯数字；地区和 ID 从 App Store 应用链接中获取。更新说明保留换行，条目按真实发布时间排序，平台和版本共同组成稳定 ID。

`rss/bilibili.js` 合并用户动态和投稿视频，导出 `/bilibili/:userid/dynamic` 与 `/bilibili/:userid/upload/video` 两条路由，`userid` 为 UP 主数字 UID。例如 `/rss/bilibili/650898515/dynamic` 和 `/rss/bilibili/650898515/upload/video`。动态支持 `offset` 游标，视频支持 `pn` 页码与 `ps` 每页数量。已有后台脚本需替换并重新确认 Cookie 授权后发布，订阅地址需改用新路径。

`rss/zhihu.js` 导出 8 条独立路由，以下路径均带 `/zhihu` 前缀：

| 路径 | 内容 |
| --- | --- |
| `/people/:user` | 用户动态 |
| `/people/:user/answers` | 回答 |
| `/people/:user/zvideos` | 视频 |
| `/people/:user/asks` | 提问 |
| `/people/:user/posts` | 文章 |
| `/column/:column_id` | 专栏 |
| `/people/:user/pins` | 想法 |
| `/collection/:collection_id` | 收藏夹 |

例如 `/rss/zhihu/people/zhihu/answers`；用户参数统一为 `user`。无后缀的用户入口读取动态，回答订阅使用 `/answers`，视频、提问、文章、想法分别使用 `/zvideos`、`/asks`、`/posts`、`/pins`。默认读取最新 20 条，动态支持 `limit`（1–50）；专栏和收藏夹支持混合内容，想法保留文字和图片，重复条目按稳定 ID 去重。两个旧知乎脚本已合并为 `rss/zhihu.js`，旧动态路径 `/zhihu/people/activities/:id` 改用 `/zhihu/people/:user`。登录 Cookie 按 `www.zhihu.com`、`zhuanlan.zhihu.com`、`api.zhihu.com` 分别声明权限。已有后台脚本需替换并重新确认 Cookie 授权后发布。

`fetch(ctx)` 返回 `Result<feed>`，`route.handler` 调用实例 `run(ctx)`。基类校验稳定 ID、标题和原文链接，按真实发布时间倒序并去重；缺失时间不补采集时间，只有相对日期文本时保留在描述中。正文、多图、视频附件、解密 key 和动态照片保留，RSS 关注文章内容与发布时间。

依赖登录的脚本在 `permissions.cookies` 中明确声明来源、Cookie 名称和用途，显式调用 `ctx.cookies.get` 获取本次执行的句柄，再传入请求；源码变化后需重新确认授权。日志演示抓取、解析与媒体处理，不记录凭证或账户页面正文。

示例不会自动导入后台。Worker 的 `test/script_examples_migration.test.js` 用生产 QuickJS 和模拟回包验证路由、排序、正文代理、RSS/Atom 渲染及媒体；未验证所有站点当前在线接口及实际登录态。SDK 仅适用于 Worker QuickJS，Go/goja 暂不支持。
