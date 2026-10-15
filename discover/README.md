# FindRSS 订阅广场模块

本目录保存广场的业务页面、脚本、样式、SSR 共用视图与测试，由主 Worker 提供页面与接口；`../public/` 只保存公共资源。统一安装、启动与部署见 [Worker README](../README.md)。


本模块提供类似 Folo Discover 的 RSS/Atom 订阅广场：默认展示管理员配置的订阅源，并支持关键词搜索、平台单选与标签多选、内容预览和 RSS 地址复制。

## 请求结构

```text
Browser
  ├── / ── 边缘缓存 ── R2 预生成首页 / 缺失时 SSR（HTML 含样式、首屏内容和完整目录）
  ├── /index.js，/assets/timeless/… ── Static Assets（直接分发）
  ├── /api/catalog ── 首页缺少内嵌数据时读取完整公开目录
  ├── /api/sources ── 保留分页 API，供兼容调用
  ├── /api/search?q=关键词 ── 仅搜索管理员已添加的订阅源
  ├── /api/preview?url=RSS地址 ── 服务端代理并限制 512KB
  ├── /api/avatar/<id> ── 项目内 API 转发 ── 订阅源头像
  └── /rss/<path>、/atom/<path> ── 项目内 API 转发 ── 自有脚本源反向代理
```

主 Worker 的 `discover.js` 处理首页、搜索、预览和头像，直接调用主 Worker 的 API 处理函数。广场只负责浏览器代码和共享视图，不包含 Worker 入口，也不生成 `_worker.js`。

`/rss/*`、`/atom/*` 和图片脚本路径由总路由直接分发到现有 API；query、请求头、鉴权和缓存行为保持原协议。预览继续校验公网 URL、限制 512KB，并验证 RSS/RDF/Atom 文档。同域脚本源预览通过进程内 API 调用读取。

## 源码布局

```text
index.js               路由声明、首页模型、全部视图与浏览器挂载入口
index.html / style.css  页面外壳与业务样式
site.webmanifest       前台 manifest，兼作后台生成基础
../public/             共用品牌、图标与通用样式
```

共享纯逻辑在 `../server/lib/discovery_feeds.js` 和 `discovery_sources.js`。SSR 外壳在 `../server/infra/discovery_home.js`；R2 静态发布和 HTTP 读取共用首页渲染器。`../scripts/timeless_plugin.js` 用于服务端、浏览器和测试构建。

前后台共用 `/brand/*` 资源，广场内嵌其使用的图标和 `/base.css`，Timeless 运行时统一保存在 `../public/assets/timeless/0.34.2/`，浏览器构建适配模块位于 `../vendor/timeless/platform_browser.js`。广场、后台与 SSR 使用配套的 Timeless 0.34.2；DOM 产物包含 hydration 的 DOM 游标、嵌套占位节点和空/相邻文本修复，Core、DOM、lite 与 SSR 必须同批同步，并同时验证 SSR/hydrate。旧 R2 首页返回时自动升级运行时脚本引用，首页边缘缓存键包含运行时版本。

首页通过同一套 SSR 渲染器生成内容，并将 `style.css` 与其依赖的 `public/base.css` 合并到 `<style data-n="discovery-stylesheet">` 中；返回的 HTML 自带样式和首屏内容，不依赖外部 CSS 或浏览器 JavaScript 才能显示首屏。响应 CSP 使用该内嵌样式的 SHA-256 哈希，不开放 `unsafe-inline`。已有 R2 首页在读取时替换为当前版本的内嵌样式；边缘缓存键包含样式哈希，样式升级不会命中旧样式页面。`/style.css` 和 `/base.css` 仍保留供兼容访问。


Logo 与平台 SVG 通过 `icons.js` 转为 data URL。订阅源头像只在目录 JSON 中保留轻量 URL，HTML 不内嵌头像字节；`lazy_img.js` 的 LazyAvatar 复用 LazyImgModel，SSR 显示首字占位，进入视口后才创建图片节点并发起请求，成功渐显，失败保留占位。API 返回的绝对 `/api/avatar/<id>` 或 `/discovery/avatars/<id>` 地址归一到同源 `/api/avatar/<id>?v=...`，保留版本参数；其他头像仅接受 HTTPS 或安全站内路径。构建、R2 发布和 SSR 均不读取头像字节，旧 R2 目录中的 raster data URL 按源 ID 恢复为头像接口并重新发布。构建同时生成可直接打开的 `index.html` 与无损 gzip 产物 `index.html.gz`，并打印原始字节数、压缩字节数和缩减比例。R2 的同一 HTML key 保存 gzip 字节与 `contentEncoding: gzip` 元数据，读取时兼容旧版明文；已有部署会在下一次目录检查时补发压缩产物。首页缓存保存解压后的 HTML，响应按原始客户端的编码能力由 Workers 自动压缩，并带 `Vary: Accept-Encoding`；避免对预压缩字节重复编码，或把压缩正文交给不支持的客户端。源码精简与传输压缩分开执行：共享 SSR 渲染器先去掉静态 HTML 外壳的缩进与换行，并用 CSSO 的浏览器 ESM 版本压缩合并后的 CSS（不重排规则）；`index.html` 本身即为紧凑源码，CSP 哈希基于压缩后的 CSS。SSR 正文、目录 JSON、内嵌图片和 hydration 节点保持原样；gzip 再对精简后的整份 HTML 做无损压缩。旧 R2 产物按渲染版本自动重新生成。

首页使用运行时静态发布：`ServiceDiscovery` 将公开目录和文章快照通过注入的异步 `render_embedded_home` 渲成 HTML，写到现有 `API_STORAGE` 桶的 `discovery/catalog/index.html`。产物包含首屏 20 个源和最多 1000 个源的完整目录 JSON；客户端接管同一套 Model/View，搜索、筛选和分页都在浏览器完成，不查询 DO。`index.js` 是两端共用的源码，Model 与 View 在文件内分别维护，`index.js` 构建为浏览器 `dist/assets/index.js`；HTML 外壳沿用 `index.html`，构建时保留 `/app.js` 别名兼容旧 R2 首页。首页使用 Timeless 0.34.2。

## 部署

在项目根目录使用 `npm run dev`；构建、测试和部署均由统一 Worker 完成。

`npm run build` 会请求公开目录接口 `/discovery/catalog`，再用 Timeless SSR 生成 `dist/assets/index.html`，产物包含真实目录、首屏文章和内嵌 CSS。默认从本地 `http://127.0.0.1:8787` 读取数据（支持 `FINDRSS_WORKER_PORT`）；API 未运行时临时启动使用同一 `.wrangler/state` 的本地 Worker，目录读取完成后关闭，不需要提前启动服务。

构建线上目录时显式设置数据来源，订阅链接域名可另用 `FINDRSS_HOSTNAME` 指定：

```bash
DISCOVERY_API_ORIGIN=https://your-worker.example FINDRSS_HOSTNAME=https://feeds.example npm run build
```

仓库根目录的 `./findrss.sh build` 同样支持这两个变量，也可写入根 `.env`。指定的数据接口不可达、返回非 2xx 或目录格式错误时构建失败，不会切换或覆盖上次成功的 `dist/assets/`。生产构建应指定线上接口，避免把本地目录作为构建快照。现有 R2 运行时发布与缺失时 SSR 继续工作，后台改动仍自动更新首页。

浏览器存在 SSR 首屏时通过 `Timeless.DOM.hydrate` 复用节点并接管交互；空外壳仍可正常挂载。

## 测试

在 Worker 根目录运行 `npm test`，覆盖首页 SSR、搜索筛选、分页、复制和路由。`index.js` 可在 Worker 中直接导出视图；浏览器挂载代码仅在存在 `document` 时运行。

广场无需登录，仅保留订阅广场首页；账号页面、登录、会话和积分接口已移除。

## 平台和标签筛选

平台沿用 `source_type` 字段，列表与名称以目录接口的 `platforms: [{ id, label }]` 为准；一次选择一个平台。前台默认网页在 `store.js` 声明，名称在 `index.js`、SVG 图标映射在 `icons.js`；后台继续使用 `components/discovery_platform.js`，两端不引用服务端平台模块。接口加载成功后完整替换默认列表，保留接口返回的名称、顺序和空列表；后台加载脚本只用于地址提示与平台推断，不改写选项。标签可多选，多个标签须同时满足，搜索词与平台、标签一起生效。

首页在 header 下方单独一行搜索，输入后延迟搜索，回车立即搜索。完整目录维持 API 的稳定排序，浏览器 Model 按关键词、平台和标签过滤，再按每页 20 个源切片；搜索匹配标题、介绍、网站、订阅地址和标签。翻页保留搜索和筛选，条件变化回到第一页。底部提供首页、上一页、下一页和末页。现有 `/api/sources` 的 SQL 筛选、分页字段和限制继续保留供兼容调用，首页不再使用它。

首页 URL 使用从 1 开始的 `page` 页码（第一页省略），并同步 `q`、`source_type` 和重复的 `tag` 参数。刷新、分享链接及浏览器前进后退恢复对应页和筛选；无效页码回到首页，超出结果范围时修正为末页。翻页成功才写入历史记录，初始加载及前进后退只修正当前地址。

重复 `tag` 参数恢复为 Model 的多个选择值，按标签精确匹配并要求同时满足。内嵌目录的 `tags` 是所有启用源的标签集合，筛选结果为空时仍保留选择入口。科技、视频、文章、音频、博客作为常用标签始终显示，管理员可自由录入其他标签。

后台不再要求分类。保留旧 `category` 存储与 API 参数兼容；旧的科技、开发、商业、科学、设计、生活分类在读取时并入标签，后台编辑保存时转为显式标签。


平台筛选和目录行使用 `public/platform-icons/` 下的同源 SVG。社媒图标取自 `wx_channels_download/frontend/public/platform-icons.svg` 的同名 symbol，保留原路径和品牌色；网站与全部使用广场已有的线形图标。资产已纳入仓库，部署不依赖另一个项目。

`qidian.svg` 与 `fanqienovel.svg` 分别参考[起点 favicon](https://qdfepccdn.qidian.com/www.qidian.com/favicon/qd_icon.ico) 和[番茄小说 favicon](https://p1-tt.byteimg.com/origin/novel-static/a3621391ca2e537045168afda6722ee9) 绘制为纯矢量路径，供项目 README 的网站分组使用。


目录卡片直接显示已发布的文章快照，每源最多 3 篇，包含标题、时间和可用封面的宽高，不逐源调用 `/api/preview`。需要 token 的源不发布文章内容；未生成、无文章和需要凭证分别显示对应状态。封面使用 `lazy_img.js` 的 LazyImg：SSR 输出占位图与已知宽高，进入视口后请求原图，加载成功渐显，失败保留占位与标题。

快照更新时，`server/infra/discovery_snapshot.js` 在原有宽高读取链路上获取 JPEG／PNG／WebP 的完整封面，经 WASM 解码、64px 降采样，计算 4×3 BlurHash 并保存为 `cover_blurhash`；浏览器与 SSR 使用同一纯函数生成占位图，无需额外接口。每张封面最多下载 2 MiB、最多解码 400 万像素，解码串行执行，同一批快照的重复 URL 只读取一次。GIF、过大图片或解码失败仍保留可用宽高和原图；旧快照要等下一次定时更新或后台手动刷新后才有 BlurHash。

自有公开源由 DO alarm 每 10 分钟生成完整 RSS/Atom XML 和文章预览，请求只读取 XML 快照。首次尚未生成的源或新参数返回 `503 + Retry-After: 5`，新参数登记后台定时任务；更新失败保留上次 XML。私密源需有效凭证，请求生成后复用 10 分钟。XML 与 feed JSON 一同持久化，DO 重建后不重新渲染；`rel="self"` 使用 `FINDRSS_HOSTNAME` 的规范地址（未配置时使用生成时的公开地址），不包含 token。脚本、Cookie 授权或源访问权限变更会使快照失效。


卡片只保留“复制 RSS”操作：默认显示 RSS 图标，复制成功后变为绿色勾选，2 秒后恢复。状态和计时器按订阅地址独立保存，复制失败不会显示成功状态。首页的预览抽屉已移除，文章列表直接使用静态快照。

## 静态发布与更新

源增删改、头像上传/移除和文章快照刷新成功后重新发布首页，不需要重新部署 Worker。写入串行执行并重新读取最新 SQL，避免并发编辑或抓取覆盖新目录。DO 首次收到请求时检查产物并补建；缺少 R2 产物或未绑定 R2 时，首页读取全量公开目录生成首屏，仍可使用本地搜索。R2 读取故障返回不可缓存的错误。

首页 Cache API 的有效期为 60 秒，忽略搜索参数和账号 Cookie，缓存键包含页面 origin 和订阅域名；浏览器每次导航重新验证，开放中的页面保留本次目录，刷新页面才读取新版本。后台修改后已有边缘缓存最多保留 60 秒，因此下架或开启 token 访问后的旧展示也可能有这段延迟；实际 RSS/Atom 访问权限仍由 API 实时校验。

发布失败会保留 SQL 修改、删除旧 R2 产物，并返回 503「目录已保存，静态发布失败，稍后自动重试」。持久化的待发布标记配合已有 DO alarm 重试，DO 重启也能恢复；不要把此错误理解为修改已回滚。`{{hostname}}` 在发布时使用占位 origin，读取时按当前 `FINDRSS_HOSTNAME` 或访问 origin 展开，避免首次访问将域名固化。

`run_worker_first` 只覆盖首页、后台和动态接口；JS/图标和兼容 CSS 地址由 Static Assets 分发，静态安全响应头由根构建生成统一 `_headers`，首页 CSP 包含内嵌样式哈希，动态响应使用同一份安全策略。订阅详情页已移除，`/s/<id>` 返回 404。构建时通过公开接口生成首页快照，运行时继续通过 R2 自动发布更新。
