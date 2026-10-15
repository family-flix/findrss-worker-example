<p align="center">
  <img src="public/brand/apple-touch-icon.png" alt="FindRSS Logo" width="96" height="96">
</p>

<h1 align="center">FindRSS Worker</h1>

<p align="center">
  自行部署爬虫脚本，把网页和接口变成 RSS 订阅源。
  <br>
  订阅广场 · RSS / Atom · 脚本工作区 · 管理后台
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#现有脚本">现有脚本</a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#一键部署到-cloudflare-workers">一键部署</a> ·
  <a href="docs/technical-guide.md">技术文档</a>
</p>

FindRSS Worker 是一个部署到 Cloudflare Workers 的 自定义脚本运行平台，支持在线脚本管理和远程设备取数。编写 JavaScript 脚本抓取网页或接口，或通过已连接的设备获取数据，返回统一的 feed JSON，即可生成自己的 RSS / Atom 订阅源，并在订阅广场展示和分享。

脚本可在管理后台编辑、调试、保存草稿、发布版本和启停，无需重新部署 Worker。脚本在 QuickJS 沙箱中执行，通过受控的 `ctx` 接口抓取内容、调用设备和记录日志。安装、构建和部署只需 Node.js、npm 与 Wrangler。

项目只部署一个 Worker：`index.js` 接入所有服务端路由与 `APIDurableObject`，业务页面、脚本和样式分别保存在 `discover/`、`admin/`；`public/` 只保存共用品牌、图标、通用样式等公共资源。后台 manifest 从前台配置生成。HTTP 入口直接位于项目根目录；账号服务和 SSR 实现在 `server/`，前端构建不生成 `_worker.js`。完整目录和路由说明见[技术指南](docs/technical-guide.md#网站与构建结构)。

## 功能亮点

| 功能 | 可以做什么 |
| --- | --- |
| 爬虫脚本 | 使用 JavaScript 抓取网页或 JSON 接口，把结果整理成可订阅的内容 |
| 订阅广场 | 关键词搜索、平台筛选、标签多选、文章快照和 RSS 地址复制 |
| 脚本工作区 | 在「代码 / 脚本助手 / Debug」三栏中编辑、真实调试、保存草稿、发布版本和启停脚本，无需重新部署 Worker |
| 沙箱执行 | QuickJS 隔离执行脚本，通过 `ctx.fetchText`、`ctx.invoke`、`ctx.log` / `ctx.error` 完成抓取、设备调用和日志记录 |
| 远程设备取数 | 通过 `ctx.invoke` 调用已连接设备的方法，支持任务排队、租约续期、失败重试和多设备并发调度 |
| RSS / Atom | 公开源后台每 10 分钟更新 XML 快照；私密源请求生成，10 分钟内复用；后台可强制刷新 |
| 访问控制 | 使用用户 Token 访问私有订阅源，也可按源开放匿名订阅 |
| 积分与兑换 | 管理用户积分、设备调用扣费、兑换活动和兑换卡批次，查看积分流水与用户操作日志 |
| 管理助手 | 按当前页面读取上下文；订阅源页支持对目录进行增删改 |
| Cookie 授权 | 按脚本版本、源码与访问范围授权，沙箱只持有凭据句柄 |

## 界面预览

以下截图来自本地运行的页面，使用独立演示数据。

**订阅广场** — 搜索与筛选订阅源，查看最近文章，复制订阅地址。

![FindRSS 订阅广场演示页面](docs/images/discovery.png)

## 一键部署到 Cloudflare Workers

<p align="left">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/ltaoo/findrss-worker">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
</p>

点击上方 **Deploy to Cloudflare**，按引导连接 GitHub / GitLab，选择 Cloudflare 账号，设置 Worker 名称和密钥后部署。Cloudflare 会复制项目、配置 Workers Builds，并按 Wrangler 配置创建所需的 Durable Object 和 R2 资源。[官方部署说明](https://developers.cloudflare.com/workers/platform/deploy-buttons/)

部署时只需将 `ADMIN_PASSWORD` 设置为后台登录密码，无需传入 `DEVICE_TOKEN`。使用项目定义的构建命令 `npm run build` 和部署命令 `npm run deploy`。完成后打开 Worker 域名的 `/admin/`，输入密码登录并创建第一个脚本；需要连接设备时，在「设备管理 → Device Token」创建凭证。

按钮指向独立公开仓库 `ltaoo/findrss-worker` 的根目录。请先创建该公开仓库并推送项目代码；仓库根目录应包含安装和构建所需的本地模块与资源。

## 快速开始

需要 **Node.js 22.19+** 和 npm。以下命令在本项目根目录执行，所需共享代码、前端资源和示例均包含在本目录中。

本地项目位于 `/Users/mayfair/Documents/other/findrss-worker`，与 `findrss/` 同级，不再放在其内部。可独立安装、测试、构建和部署；从原仓库运行 `./findrss.sh` 时也会使用这个同级目录。

安装依赖并创建本地配置：

```bash
cd /Users/mayfair/Documents/other/findrss-worker
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

启动命令先构建前端资源，再由 Wrangler 打包并启动本地 Worker。打开：

| 地址 | 用途 |
| --- | --- |
| <http://127.0.0.1:8787/> | 订阅广场 |
| <http://127.0.0.1:8787/admin/> | 管理后台 |
| <http://127.0.0.1:8787/health> | 健康检查 |

示例配置中的本地后台用户名为 `admin`，密码为 `local-admin-token`。本地配置只用于开发，生产部署时请设置独立的随机长密钥。

首次启动的订阅广场为空，不再预置外部订阅源。登录后台后，在「订阅源」中添加外部 RSS / Atom 地址；需要生成自己的订阅源时，先在「脚本」中发布脚本，再添加对应的订阅地址。旧版本已写入的示例源可在后台手动删除。

### 常用命令

以下命令在本项目根目录执行：

```bash
npm run build     # 构建后台、广场和共享静态资源
npm test          # 运行测试
npm run dry-run   # 检查部署产物
npm run deploy    # 部署到 Cloudflare
```

构建会读取目录接口并用 Timeless SSR 生成带内嵌 CSS 和首屏内容的首页。默认读取本地 Worker 数据；本地未启动时会临时启动并在取数后关闭。生产构建请通过 `DISCOVERY_API_ORIGIN=https://你的Worker域名` 指定线上目录，`FINDRSS_HOSTNAME` 可另指定订阅域名。接口失败会中止构建并保留上次产物，详见 [构建取数说明](discover/README.md#部署)。

停止本地服务时，在启动终端按 Ctrl+C。

## 创建自己的订阅源

在后台「脚本」的 RSS Tab 新建脚本，填入下面的最小示例：

```js
import { utils } from "@findrss/util";

export const route = {
  path: "/demo/go-blog",
  name: "Go 官方博客",
  example: "/demo/go-blog",
  async handler(ctx) {
    const fetched = await ctx.fetchText("https://go.dev/blog/feed.atom");
    if (fetched.error) return fetched;
    const parsed = utils.feed_items(fetched.data, "https://go.dev/blog/");
    if (parsed.error) return parsed;
    return Result.Ok({
      title: "Go 官方博客",
      link: "https://go.dev/blog/",
      description: "通过爬虫脚本抓取并转换的订阅源",
      items: parsed.data,
    });
  },
};
```

运行 Debug 检查结果，以 `1.0.0` 发布正式版本并启用脚本，然后在「订阅源」添加 `{{hostname}}/rss/demo/go-blog`。同一路由也可通过 `/atom/demo/go-blog` 获取 Atom。

RSS / Atom 默认需要访问 Token，可通过 `?token=`、`Authorization: Bearer` 或 `X-FindRSS-Token` 提供。在启用中的自有订阅源上关闭「需要 token 访问」后，该路由公开。公开性按路由 pathname 判断，忽略 query，并对 RSS / Atom 两种前缀同时生效。

更多完整示例见 [脚本](examples/rss/)、[热榜脚本](examples/hot/)和[脚本基类示例](examples/script-classes/)。这些文件不会自动导入后台。

## 现有脚本

[`examples/rss/`](examples/rss/) 目前包含 17 个脚本。点击脚本名称查看源码，复制整个 `.js` 文件到后台「脚本」的 RSS Tab，运行 Debug，确认后发布并启用，再添加订阅源。脚本使用 Worker QuickJS 内置的 `RSSScript`、`Result` 和 `@findrss/util`。

以下按网站分组。订阅路由中的参数需替换成实际账号或作品标识，并在路径前加 `/rss` 或 `/atom`。例如 B 站视频订阅地址为 `{{hostname}}/rss/bilibili/user/video/650898515`。

依赖 Cookie 的脚本需先同步有效登录 Cookie，可使用 [dm-extension 插件](https://github.com/ltaoo/dm-extension) 完成同步，再由管理员确认脚本声明的 `permissions.cookies` 授权；源码变化后需重新确认授权。

章节正文和图片代理是附加路由，直接按声明路径访问，不加 `/rss` 或 `/atom`。完整参数和附加路由见各脚本源码与 [RSS 示例说明](examples/rss/README.md)。

示例不会自动导入后台；上游接口、登录状态和风控会影响抓取结果，发布前请用自己的参数与授权运行 Debug。

### <img src="public/platform-icons/bilibili.svg" width="24" height="24" alt="" data-n="rss-bilibili-icon"> Bilibili · 哔哩哔哩

需授权 B 站登录 Cookie。`uid` 为 UP 主数字 UID。

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [用户视频](examples/rss/bilibili_user_video.js) | `/bilibili/user/video/:uid` | UP 主投稿视频 |
| [用户动态](examples/rss/bilibili_user_dynamic.js) | `/bilibili/user/dynamic/:uid` | 图文、视频卡片、专栏与转发 |

### <img src="public/platform-icons/zhihu.svg" width="24" height="24" alt="" data-n="rss-zhihu-icon"> 知乎

需授权知乎 Cookie。[用户与内容脚本](examples/rss/zhihu_user.js) 包含以下 8 条路由，`user_id` 为用户主页 `/people/` 后的标识。

| 功能 | 订阅路由 | 内容 |
| --- | --- | --- |
| 用户动态 | `/zhihu/people/:user_id` | 用户最近动态 |
| 用户回答 | `/zhihu/people/:user_id/answers` | 用户发布的回答 |
| 用户视频 | `/zhihu/people/:user_id/zvideos` | 用户发布的视频 |
| 用户提问 | `/zhihu/people/:user_id/asks` | 用户提出的问题 |
| 用户文章 | `/zhihu/people/:user_id/posts` | 用户发布的文章 |
| 用户想法 | `/zhihu/people/:user_id/pins` | 想法文字与图片 |
| 专栏 | `/zhihu/column/:column_id` | 指定专栏的内容 |
| 收藏夹 | `/zhihu/collection/:collection_id` | 指定收藏夹的内容 |

另有 [独立用户动态脚本](examples/rss/zhihu_user_activities.js)：`/zhihu/people/activities/:id`，支持通过 `limit` 参数设置动态数量。

### <img src="public/platform-icons/douyin.svg" width="24" height="24" alt="" data-n="rss-douyin-icon"> 抖音

需授权抖音 Cookie。`sec_uid` 取作者主页 `/user/` 后的标识。

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [作者作品](examples/rss/douyin_user.js) | `/douyin/user/:sec_uid` | 投稿视频与图集 |

### <img src="public/platform-icons/kuaishou.svg" width="24" height="24" alt="" data-n="rss-kuaishou-icon"> 快手

需授权含 `kwfv1` 的有效快手 Cookie。

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [用户作品](examples/rss/kuaishou_user.js) | `/kuaishou/user/:user_id` | 最新一页作品 |

### <img src="public/platform-icons/xiaohongshu.svg" width="24" height="24" alt="" data-n="rss-xiaohongshu-icon"> 小红书

需授权小红书 Cookie。`uid` 为用户主页中的 24 位十六进制 ID，不是小红书号。

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [用户笔记](examples/rss/xiaohongshu_user.js) | `/xiaohongshu/user/:uid` | 首屏笔记与封面 |

### <img src="public/platform-icons/weibo.svg" width="24" height="24" alt="" data-n="rss-weibo-icon"> 微博

需授权微博登录 Cookie。

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [用户微博](examples/rss/weibo.js) | `/weibo/:uid` | 用户微博与媒体，附图片代理 |

### <img src="public/platform-icons/x.svg" width="24" height="24" alt="" data-n="rss-x-icon"> X

需授权含 `auth_token`、`ct0` 的有效 X Cookie。

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [用户作品](examples/rss/x_user.js) | `/x/user/:username` | 最新一页推文 |

### <img src="public/platform-icons/youtube.svg" width="24" height="24" alt="" data-n="rss-youtube-icon"> YouTube

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [频道视频](examples/rss/youtube.js) | `/youtube/:handle` | 视频首屏列表与内嵌播放器；handle 的 `@` 可省略 |

### <img src="public/platform-icons/telegram.svg" width="24" height="24" alt="" data-n="rss-telegram-icon"> Telegram

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [公开频道](examples/rss/telegram_channel.js) | `/telegram/channel/:username` | 文本、照片与视频；无需 Bot Token |

### <img src="public/platform-icons/wxmp.svg" width="24" height="24" alt="" data-n="rss-weixin-icon"> 微信

需连接支持对应方法的设备；公众号还需配置 `FINDRSS_HOSTNAME` 用于图片代理。

| 功能 / 源码 | 订阅路由 | 内容与设备方法 |
| --- | --- | --- |
| [公众号](examples/rss/wxmp_biz_msg_list.js) | `/wxmp/:account?` | 文章与图集；`wxmp.biz.msg.list` |
| [视频号](examples/rss/wxchannels_contact_feed_list.js) | `/wxchannels/:account` | 视频、图集、Live Photo 与直播；`wxchannels.contact.feed.list` |

### <img src="public/platform-icons/fanqienovel.svg" width="24" height="24" alt="" data-n="rss-fanqienovel-icon"> 番茄小说

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [小说章节](examples/rss/fanqienovel_chapters.js) | `/fanqienovel/book/:book_id` | 完整目录倒序输出，附章节 HTML 正文路由 |

### <img src="public/platform-icons/qidian.svg" width="24" height="24" alt="" data-n="rss-qidian-icon"> 起点中文网

需授权起点 Cookie；付费章节需账号具备阅读权限。

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [小说章节](examples/rss/qidian_chapters.js) | `/qidian/book/:book_id` | 完整跨卷目录与章节正文 |

### <img src="public/platform-icons/website.svg" width="24" height="24" alt="" data-n="rss-69shuba-icon"> 69 书吧

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [小说章节](examples/rss/69shuba_chapters.js) | `/69shuba/book/:book_id` | 完整目录倒序输出，不抓取正文 |

### <img src="public/platform-icons/website.svg" width="24" height="24" alt="" data-n="rss-ttk-icon"> 天天看书

| 功能 / 源码 | 订阅路由 | 内容 |
| --- | --- | --- |
| [小说章节](examples/rss/ttk_chapters.js) | `/ttk/book/:book_id` | 完整目录倒序输出，不抓取正文；参数取 `/novel/` 后的标识，不含 `.html` |

## 部署到 Cloudflare

需要可使用 Workers、SQLite Durable Objects 和 R2 的 Cloudflare 账号。部署使用本项目的 [wrangler.jsonc](wrangler.jsonc)，后台与广场静态资源随 Worker 一起发布。

在本项目根目录执行：

```bash
npm ci
npx wrangler login
npx wrangler r2 bucket create findrss-storage
npx wrangler secret put ADMIN_PASSWORD
npm run dry-run
npm run deploy
```

R2 桶只需创建一次，已有同名桶可跳过。`secret put` 命令会提示输入生产密钥，`ADMIN_PASSWORD` 同时是后台登录密码。

| 配置 | 要求 | 用途 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 必需 secret | 后台登录与管理 API 认证 |
| `DEVICE_TOKEN` | 可选旧配置 | 自动导入后台 Device Token 列表，保留原设备接入能力 |
| `READER_SESSION_SECRET` | 可选 secret | 中央账号会话签名；未配置时依次回退旧 `DEVICE_TOKEN`、`ADMIN_PASSWORD` |
| `FINDRSS_HOSTNAME` | 可选变量 | 展开 `{{hostname}}`；留空按请求 origin 展开，可指定公开域名 |
| `COOKIE_PUSH_UUID` / `COOKIE_PUSH_KEY` | 使用 Cookie 推送时配置 | 接收 Cookie 同步凭据 |
| `API_STORAGE` | Wrangler 已声明的 R2 绑定 | 存储头像、公开目录和文章快照 |

固定订阅域名时，设置 `wrangler.jsonc` 的 `vars.FINDRSS_HOSTNAME`。模型厂商与 API Key 可在后台「大模型设置」中配置。

### 管理 Device Token

登录后台，在「设备管理」点击 **Device Token**：

- 可创建多个凭证，填写名称和备注；有效期可选 7 天、30 天、90 天、1 年或永不过期，默认 30 天。
- 列表显示掩码、状态、创建时间、到期时间和最近使用时间，支持编辑备注。
- 点击「查看明文」后可复制；可手动隐藏，30 秒后自动隐藏，收起管理面板也会清除已显示的明文。
- 点击「撤销」立即使凭证失效并断开关联设备，到期也会失效。撤销不可恢复；需要时创建新 Token 并更新设备配置。

设备协议保持不变：将创建的 Token 作为 `Authorization: Bearer <token>`，同时提供 `X-Api-Device-ID` 连接 `/v1/connect`。这与 RSS 用户访问 Token 是两类凭证。

Token 使用随机值，服务端保存 SHA-256 摘要用于鉴权，并用 `ADMIN_PASSWORD` 派生的 AES-GCM 密钥保存加密副本，供管理员按需查看；列表不返回明文。撤销时删除加密副本。**更换 `ADMIN_PASSWORD` 后，已有设备 Token 的明文将无法解密，但摘要鉴权仍有效**，可创建新 Token 替换。

升级时，旧 `DEVICE_TOKEN` 会自动导入为「原部署 Device Token」，可在后台撤销，重启不会重新激活它；已有设备连接需重新连接以绑定凭证。若阅读端仍依赖旧 `DEVICE_TOKEN` 签名，移除该环境变量前先将 `READER_SESSION_SECRET` 设置为原值，并在阅读端使用相同密钥，避免旧会话失效。

已有部署升级时，**保留原 Worker 名，或先安排 DO 数据迁移**：修改 Worker 名会创建新的 DO 命名空间，原数据不会自动迁移。部署也不会自动删除旧 Worker 或旧 Pages 项目。


构建入口为 `scripts/build.js`，其他构建与维护工具也集中在 `scripts/`。`npm run build` 从 `public/` 复制公共资源，从 `admin/`、`discover/` 构建前后台业务文件，原子生成 `dist/assets/`；Wrangler 在 dev、deploy 和 dry-run 时直接从 `index.js` 打包主 Worker 与 QuickJS WASM，避免预先打包同一份服务端代码。只有 `dist/assets/` 作为静态资源公开；产物由构建生成，不直接编辑。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [技术指南](docs/technical-guide.md) | 原有技术说明、脚本版本、助手配置、Result、工具模块、基类与 Cookie 授权 |
| [管理后台](admin/README.md) | 登录会话、脚本、消息和订阅源管理 |
| [订阅广场](discover/README.md) | 搜索筛选、目录快照、静态发布与更新 |

## 参与贡献

反馈问题时，请提供复现步骤、相关路由和脱敏日志。修改代码时沿用现有分层与 Model / View 约定，提交前运行相关测试和构建。

新增脚本可以参考已有示例，提供 `route.example`，并用后台 Debug 验证。修改项目内的 `packages/` 后，执行 `npm install` 并更新 lockfile。

README 的组织方式参考 [Best-README-Template](https://github.com/othneildrew/Best-README-Template) 。
