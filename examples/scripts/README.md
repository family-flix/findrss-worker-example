# 脚本示例

## 区域剪藏

[region_clip.js](region_clip.js) 是可在脚本环境执行的区域剪藏示例。它通过 `ctx.puppeteer.navigate(url, options, extract_clip)` 使用 `@cloudflare/puppeteer` 渲染页面，再在页面内提取 DOM 与计算样式。宿主仅提供渲染与函数执行能力，区域提取逻辑保留在脚本中。部署需提供 `BROWSER` 绑定，无需 REST 账号、Token 或渲染方式开关。

后台「剪藏」直接复用该脚本的 handler。在「剪藏」创建记录，填写来源网址、CSS 选择器、采集视口和刷新规则。也可将示例导入脚本，在配置表单中设置 `url`、`selector`、视口和等待时间。选择器取第一个匹配节点，等待其可见后连同子树、计算样式、可读取的图片与背景图一起冻结；`::before` / `::after` 的字符串内容会还原，Canvas 尽量转图片。提取结果为 `{ ok, html, stats }`；后台剪藏由宿主清理并保存，公开链接为 `/clips/<记录 ID>`，普通脚本仍受 2MB 路由输出上限约束。

记录按后台默认抓取策略或单条规则定时更新；也可立即采集、暂停定时。刷新失败保留旧快照，编辑后迟到的结果不会覆盖新规则。嵌入代码从后台「预览与嵌入」复制，iframe 只读取最近一次成功快照，不触发浏览器采集，也不执行 JavaScript。

产出仅保留静态 HTML 与内联 CSS，图片使用 data URL；外部脚本、样式表、内联事件、音视频、iframe 与交互入口被移除。无法读取的图片占位，自定义字体退回系统字体，部分伪元素和封闭 Shadow DOM 无法完整还原。每条最多 6000 个元素、60 张图片和 8MB HTML；最多保存 100 条记录。iframe 无 JavaScript，不会自动调整高度，可按需要修改嵌入代码的 `height`。

非浏览器检查：`node --test test/clips.test.js admin/__tests__/clips.test.mjs`。测试模拟 Browser Rendering 回包，不实际启动或调用浏览器；真实站点的选择器和样式由用户手动验证。

## RSS 与热榜

本目录的 RSS 脚本使用全局 `RSSScript` 和 `import { utils } from '@findrss/util'`，接口请求、JSON 解析和校验返回 `Result`。

每个脚本通过 `export const platform = { name, icon }` 声明来源，`icon` 已直接内嵌对应的 SVG 源码；多路由共用此对象，也可用 `route.platform` 覆盖。正式版本发布成功后才收集来源到数据库，供订阅广场与后台来源筛选 Select 使用，保存草稿和 Debug 不注册来源。

可用 `export const tags = ['科技', '文章']` 声明共用标签，或用 `route.tags` 逐条覆盖（`[]` 表示无标签）。每条路由最多 13 个不同标签，每个为去除首尾空白后的 1–32 字符且不含控制字符。正式发布后聚合为 discover 和后台的可选标签，新建自有源时按匹配路由预填，可手动修改；草稿和 Debug 不注册标签。标签属于脚本元数据，不是 handler 返回的 feed 字段。

复制单个 `.js` 到管理后台 `/admin/scripts` 的 RSS Tab，可保存草稿、运行 Debug，确认后发布。同一主路由可用 `/rss/<path>` 或 `/atom/<path>` 获取订阅。章节正文等附加路由仍返回 HTML。

## 选择脚本

以下路径为脚本声明的主路由，订阅时在前面加 `/rss` 或 `/atom`，并将 `:参数` 替换为实际值。标注 Cookie 的脚本需先同步对应站点的 Cookie，并在后台确认脚本权限；微信公众号和视频号需连接支持对应能力的设备。

| 脚本 | 主路由 | 采集内容与使用要求 |
| --- | --- | --- |
| [哔哩哔哩](rss/bilibili.js) | `/bilibili/:userid/dynamic`、`/bilibili/:userid/upload/video` | UP 主动态与投稿视频；`userid` 为数字 UID，需授权 Cookie |
| [YouTube](rss/youtube.js) | `/youtube/:handle`、`/youtube/:handle/shorts` | 频道视频与 Shorts 首屏列表；`handle` 的 `@` 可省略，需授权 Cookie |
| [知乎](rss/zhihu.js) | `/zhihu/people/:user` 等 8 条路由，见下方 | 动态、回答、视频、提问、文章、专栏、想法与收藏夹；需授权 Cookie |
| [微博](rss/weibo.js) | `/weibo/u/:uid` | 用户微博及图片、视频；`uid` 为数字用户 ID，需授权 Cookie |
| [X](rss/x.js) | `/x/:username` | 用户推文，读取上游返回的一页；用户名的 `@` 可省略，需授权 Cookie |
| [Instagram](rss/instagram.js) | `/instagram/:username` | 用户首屏图片、视频与多图作品，保留发布时间；需授权登录 Cookie |
| [抖音](rss/douyin.js) | `/douyin/user/:sec_uid` | 作者视频与图集；使用主页 `/user/` 后的 `sec_uid`，需授权 Cookie |
| [快手](rss/kuaishou.js) | `/kuaishou/profile/:user_id` | 作者最新一页作品；使用主页 `/profile/` 后的 ID，需授权完整登录与验证 Cookie |
| [小红书](rss/xiaohongshu.js) | `/xiaohongshu/user/profile/:uid` | 默认读取首屏笔记和封面；加 `?full_content=true`（或 `1`）逐条请求详情获取完整正文、图集和视频；`uid` 为 24 位十六进制 ID，需授权 Cookie |
| [Telegram](rss/telegram.js) | `/telegram/channel/:username` | 公开频道文本、照片与视频；用户名的 `@` 可省略，无需 Bot Token |
| [微信公众号](rss/wxmp.js) | `/wxmp/:account?` | 文章与图集；使用公众号微信号或原始 ID，需设备支持 `wxmp.biz.msg.list` |
| [微信视频号](rss/wxchannels.js) | `/wxchannels/:account` | 视频、图集、Live Photo 与直播；使用视频号 `username`，需设备支持 `wxchannels.contact.feed.list` |
| [番茄小说](rss/fanqienovel.js) | `/fanqienovel/book/:book_id` | 完整章节目录与正文代理；ID 来自详情页 `/page/` 后的数字 |
| [起点中文网](rss/qidian.js) | `/qidian/book/:book_id` | 完整跨卷目录与正文代理；需授权 Cookie，付费章节需有效阅读权限 |
| [69 书吧](rss/69shuba.js) | `/69shuba/book/:book_id` | 完整章节目录，不抓取正文；ID 来自 `/book/<ID>.htm` |
| [天天看书](rss/ttk.js) | `/ttk/book/:book_id` | 完整章节目录，不抓取正文；标识来自 `/novel/` 后的路径，不含 `.html` |
| [Apple App Store](rss/apple.js) | `/apple/apps/update/:country/:id/:platform?` | 应用版本更新；使用 App Store 链接中的地区与应用 ID |

抖音支持 `?count=18&max_cursor=0`（每页最多 30 条），Telegram 支持 `?before=<消息 ID>`，微信公众号和视频号支持 `?offset=<游标>`。微信公众号也可使用 `/rss/wxmp?username=wow36kr`，与 `/rss/wxmp/wow36kr` 等价；图片代理需配置 `FINDRSS_HOSTNAME`。

YouTube 普通视频根据页面中英文相对时间估算发布时间，月、年分别按 30、365 天计算；Shorts 页面未提供时间时不估算。小红书的用户 ID 不是小红书号。快手通过作品接口读取数据，需同步完整的登录与验证 Cookie，包括 `kuaishou.server.webday7_st`、`kuaishou.server.webday7_ph` 和 `kwfv1`；主页能打开不代表作品接口可用。

番茄小说正文路径为 `/fanqienovel/chapter/:chapter_id`，起点正文路径为 `/qidian/chapter/:book_id/:chapter_id`，直接返回 HTML，无需加 `/rss` 或 `/atom` 前缀。

## 路由与参数说明

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

## 编写与验证

`fetch(ctx)` 返回 `Result<feed>`，`route.handler` 调用实例 `run(ctx)`。基类校验稳定 ID、标题和原文链接，按发布时间倒序并去重；缺失时间不补采集时间。YouTube 普通视频会估算相对日期，小说目录按章节序号或目录顺序倒序输出。正文、多图、视频附件、解密 key 和动态照片保留，RSS 关注文章内容与发布时间。

依赖登录的脚本在 `permissions.cookies` 中明确声明来源、Cookie 名称和用途，显式调用 `ctx.cookies.get` 获取本次执行的句柄，再传入请求；源码变化后需重新确认授权。日志演示抓取、解析与媒体处理，不记录凭证或账户页面正文。

示例不会自动导入后台。Worker 的 `test/script_examples_migration.test.js` 用生产 QuickJS 和模拟回包验证路由、排序、正文代理、RSS/Atom 渲染及媒体；未验证所有站点当前在线接口及实际登录态。SDK 仅适用于 Worker QuickJS，Go/goja 暂不支持。

## 回复、转发与原帖引用

`rss/x.js` 与 `rss/weibo.js` 用 `item.kind` 区分 `post`（原创）、`reply`（回复）、`repost`（转发）和 `quote`（引用）。现有 `item.type` 继续表示 `article`、`gallery`、`video`、`live`，可与互动类型同时使用。

原帖通过 `references` 返回，当前条目的正文、作者、图片和视频仅属于当前帖；原帖保留自己的完整 item 字段。单条内容可同时回复一篇、引用另一篇：

```js
{
  id: "x:tweet:200", kind: "reply", title: "我的回复",
  link: "https://x.com/replier/status/200", description: "我的回复",
  references: [{
    relation: "reply", id: "x:tweet:100", link: "https://x.com/original/status/100",
    item: {
      id: "x:tweet:100", kind: "post", title: "原帖",
      link: "https://x.com/original/status/100", content: "<p>原帖正文</p>",
      author: { name: "原作者", uri: "https://x.com/original" },
      images: ["https://example.com/original.jpg"]
    }
  }]
}
```

`relation` 支持 `reply`、`repost`、`quote`。`id`、`link` 至少提供一个，缺省时可从子项补齐。已知原帖删除或不可用时返回 `unavailable: true` 并省略 `item`；权限不足、请求失败或没有返回正文时仅保留引用，避免将请求失败误判为删除。

RSS 输出示例（Atom 中内嵌节点为 `entry`，其余扩展结构相同）：

```xml
<item>
  <title>我的回复</title>
  <findrss:kind xmlns:findrss="https://findrss.cloud/ns/reader">reply</findrss:kind>
  <findrss:reference xmlns:findrss="https://findrss.cloud/ns/reader"
      relation="reply" ref="x:tweet:100" href="https://x.com/original/status/100">
    <item>
      <title>原帖</title>
      <link>https://x.com/original/status/100</link>
      <guid isPermaLink="false">x:tweet:100</guid>
    </item>
  </findrss:reference>
</item>
```

内嵌原帖复用同一套 RSS/Atom 正文、署名、时间、媒体和引用渲染规则；不会成为顶层独立文章。FindRSS 共用解析器也保留 `article.kind` 与 `article.references`，子项使用解析后的 article 结构（稳定标识为 `guid`），原帖媒体不会混进父项。

脚本优先使用列表内嵌原帖，其次复用本页已有内容，再尝试详情接口补取；每次执行最多补取 8 个不同原帖，引用链最多内嵌 4 层，达到上限保留 ID/链接。X 补取依赖页面提供的客户端脚本和可用 GraphQL 操作。微博详情使用现有授权 Cookie，原微博图片和表情同样经过图片代理。仍只处理上游返回的这一页内容，不额外抓取完整回复或评论列表。已有后台脚本需替换示例、确认源码对应的 Cookie 授权后重新发布。

微博转发列表若通过 `analysis_extra.mblog_parent_id` 提供直接父帖 ID，会逐层补取中间转发；确认父帖后，将首个 `//@父帖作者:` 后的历史转发语交由父帖展示。父帖不可访问、已删除或达到补取上限时，保留未还原的转发文字和已知原帖，不根据用户名编造帖子 ID。
