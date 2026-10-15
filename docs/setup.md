# 安装与配置

[返回项目介绍](../README.md)。本指南包含部署、本地运行、自定义订阅源与设备配置。

## 一键部署到 Cloudflare Workers

<p align="left">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/ltaoo/findrss-worker">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
</p>

点击上方 **Deploy to Cloudflare**，按引导连接 GitHub / GitLab，选择 Cloudflare 账号，设置 Worker 名称和密钥后部署。Cloudflare 会复制项目、配置 Workers Builds，并按 Wrangler 配置创建所需的 Durable Object 和 R2 资源。[官方部署说明](https://developers.cloudflare.com/workers/platform/deploy-buttons/)

部署时必须填写 `ADMIN_PASSWORD`，作为后台登录密码；该密钥没有默认值，请自行设置随机长密码。无需传入 `DEVICE_TOKEN`、`FINDRSS_HOSTNAME` 或 `FEED_HOSTNAME`，域名默认使用当前访问地址。使用项目定义的构建命令 `npm run build` 和部署命令 `npm run deploy`。完成后打开 Worker 域名的 `/admin/`，输入密码登录并创建第一个脚本；需要连接设备时，在「设备管理 → Device Token」创建凭证。

## 本地运行

需要 **Node.js 22.19+** 和 npm。以下命令在本项目根目录执行，所需共享代码、前端资源和示例均包含在本目录中。

安装依赖并创建本地配置：

```bash
npm ci
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填写 ADMIN_PASSWORD 后再启动
npm run dev
```

启动命令先启动本地 API Worker，等待服务就绪后准备前端资源；Discover SSR 从这个 Worker 读取目录。开发时 admin 由浏览器原生 ES modules 加载，启动时仅预打包 npm 依赖；修改 `admin/` 下的 JS、CSS 或 HTML 后直接刷新页面，无需重新构建或重启服务。`npm run build` 和部署仍将 admin 打包为生产资源。

资源准备完成后继续使用同一个 Worker 提供页面与 API，按 Ctrl+C 一起停止。首次启动会自动创建静态资源目录；运行时临时文件放在项目 `.wrangler/tmp/runtime`，避免系统临时目录权限导致启动失败。启动错误会直接显示，等待超过 60 秒会报错退出。默认端口为 8787，可通过 `FINDRSS_WORKER_PORT` 修改。打开：

| 地址 | 用途 |
| --- | --- |
| <http://127.0.0.1:8787/> | 订阅广场 |
| <http://127.0.0.1:8787/admin/> | 管理后台 |
| <http://127.0.0.1:8787/health> | 健康检查 |

本地后台用户名为 `admin`，密码使用你在 `.dev.vars` 中填写的 `ADMIN_PASSWORD`，没有默认值。本地配置只用于开发，生产部署时请设置独立的随机长密码。

首次启动的订阅广场为空，不再预置外部订阅源。登录后台后，在「订阅源」中添加外部 RSS / Atom 地址；需要生成自己的订阅源时，先在「脚本」中发布脚本，再添加对应的订阅地址。旧版本已写入的示例源可在后台手动删除。

### 常用命令

以下命令在本项目根目录执行：

```bash
npm run build     # 构建后台、广场和共享静态资源
npm test          # 运行测试
npm run dry-run   # 检查部署产物
npm run deploy    # 部署到 Cloudflare
```

构建默认先启动本地 API Worker，等待就绪，再读取目录接口并用 Timeless SSR 生成带内嵌 CSS 和首屏内容的首页；构建结束后关闭该实例。生产构建请通过 `DISCOVERY_API_ORIGIN=https://你的Worker域名` 指定线上目录，此时直接使用指定接口；`FINDRSS_HOSTNAME` 可另指定订阅域名。接口失败会中止构建并保留上次产物，详见 [构建取数说明](../discover/README.md#部署)。

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

更多完整示例见 [RSS 脚本](../examples/scripts/rss/)、[热榜脚本](../examples/scripts/hot/)和[脚本示例说明](../examples/scripts/README.md)。这些文件不会自动导入后台。

## 手动部署与配置

需要可使用 Workers、SQLite Durable Objects 和 R2 的 Cloudflare 账号。部署使用本项目的 [wrangler.jsonc](../wrangler.jsonc)，后台与广场静态资源随 Worker 一起发布。

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

需要固定订阅域名时，可自行在 `wrangler.jsonc` 中添加 `vars.FINDRSS_HOSTNAME`。本地开发可在项目根目录的 `.env` 或 `.dev.vars` 中设置 `FINDRSS_HOSTNAME=http://127.0.0.1:8787`，修改后重启 `npm run dev`；兼容旧名称 `FEED_HOSTNAME`，同时设置时优先使用 `FINDRSS_HOSTNAME`。存在 `.dev.vars` 时 Wrangler 不读取 `.env`。未配置时，订阅地址和手动快照刷新使用当前访问地址，脚本的 `ctx.public_origin` 也使用该地址生成图片代理等绝对链接；通过 workers.dev 或自定义域名访问均可。发现页的定时快照刷新沿用最近一次访问的域名，该域名会持久化保存。模型厂商与 API Key 可在后台「大模型设置」中配置。

### 管理 Device Token

登录后台，打开「设置」中的 **Device Token**，或在「设备管理」点击 **Device Token**：

- 可创建多个凭证，填写名称和备注；有效期可选 7 天、30 天、90 天、1 年或永不过期，默认 30 天。
- 创建成功后自动弹窗展示明文，可直接复制；关闭弹窗或离开设置页会清除弹窗中的明文。
- 列表显示掩码、状态、创建时间、到期时间和最近使用时间，支持编辑备注。
- 点击「查看明文」后可复制；可手动隐藏，30 秒后自动隐藏，收起管理面板也会清除已显示的明文。
- 点击「撤销」立即使凭证失效并断开关联设备，到期也会失效。撤销不可恢复；需要时创建新 Token 并更新设备配置。

设备协议保持不变：将创建的 Token 作为 `Authorization: Bearer <token>`，同时提供 `X-Api-Device-ID` 连接 `/v1/connect`。这与 RSS 用户访问 Token 是两类凭证。

Token 使用随机值，服务端保存 SHA-256 摘要用于鉴权，并用 `ADMIN_PASSWORD` 派生的 AES-GCM 密钥保存加密副本，供管理员按需查看；列表不返回明文。撤销时删除加密副本。**更换 `ADMIN_PASSWORD` 后，已有设备 Token 的明文将无法解密，但摘要鉴权仍有效**，可创建新 Token 替换。

升级时，旧 `DEVICE_TOKEN` 会自动导入为「原部署 Device Token」，可在后台撤销，重启不会重新激活它；已有设备连接需重新连接以绑定凭证。若阅读端仍依赖旧 `DEVICE_TOKEN` 签名，移除该环境变量前先将 `READER_SESSION_SECRET` 设置为原值，并在阅读端使用相同密钥，避免旧会话失效。

已有部署升级时，**保留原 Worker 名，或先安排 DO 数据迁移**：修改 Worker 名会创建新的 DO 命名空间，原数据不会自动迁移。部署也不会自动删除旧 Worker 或旧 Pages 项目。

构建入口为 `scripts/build.js`，其他构建与维护工具也集中在 `scripts/`。`npm run build` 从 `public/` 复制公共资源，从 `admin/`、`discover/` 构建前后台业务文件，原子生成 `dist/assets/`；`npm run dev` 使用独立的 `dist/assets.dev/`，避免生产构建覆盖正在使用的开发资源。Wrangler 在 dev、deploy 和 dry-run 时直接从 `index.js` 打包主 Worker 与 QuickJS WASM，避免预先打包同一份服务端代码。静态资源来自对应的产物目录；产物由构建生成，不直接编辑。
