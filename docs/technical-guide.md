# FindRSS Worker 技术指南

项目介绍、截图与快速开始见 [Worker README](../README.md)。

一个 Cloudflare Worker 提供共享 API，admin 和 discover 各自保留独立前端入口、页面与构建。

- admin：`admin/`，后台入口 `/admin/`，使用自己的 HTML、脚本、样式和管理员登录。
- discover：`discover/`，广场入口 `/`，使用自己的 HTML、脚本、样式和 SSR。

两套前端分别构建，分别使用自己的页面外壳和业务状态，均调用同一套 API 与 `APIDurableObject`。

订阅广场构建时请求公开目录接口并复用 Timeless SSR 生成含首屏内容、内嵌 CSS 和完整目录的 HTML。默认先启动本地 API Worker，等待就绪后再构建，结束后关闭该实例；`DISCOVERY_API_ORIGIN` 指定接口来源时直接使用指定接口，生产构建应指定线上接口，取数失败不覆盖已有产物。运行时继续将目录和文章快照写入 R2，目录、头像和快照变化自动重发，首页边缘缓存 60 秒；缺少产物时兼容读取 DO，发布失败持久化标记并由 alarm 重试。搜索/筛选/分页在浏览器完成，客户端通过 hydrate 接管首屏。详见 [广场构建说明](../discover/README.md#部署)与[静态发布说明](../discover/README.md#静态发布与更新)。

自有私密订阅源通过 `discovery_sources.credit_cost` 配置每次成功访问的积分，默认 1，取值为 0 到 1000000000 的整数；新库与旧库迁移均默认 1。读取 RSS/Atom XML（含缓存命中）在返回前以同步事务更新 token 余额、累计用量并写入账本，余额不足返回 402；账本写入失败会回滚余额。后台生成、管理预览与该源脚本内的设备调用不再重复扣费。公开源免费，外部源不在本 Worker 计费。计价优先匹配路由与归一化 query，忽略域名和 RSS/Atom 格式；未匹配 query 时沿用同路径私密源的配置。

订阅广场卡片直接读取 `discovery_source_snapshots` 中的文章快照，与目录一起返回，不逐源请求 `/api/preview`。DO alarm 按源规则更新启用的公开源及私密自有源，每批最多 4 个，默认每 1 小时抓取。后台「设置 → 订阅源抓取」配置默认规则，新增或编辑订阅源时可继承默认，或单独选择按间隔、智能刷新、每天指定时间、多个时间点、分时段、自定义五段 Cron、仅手动；定时规则支持 IANA 时区和星期，分时段支持跨午夜，时段外可停止抓取。间隔范围为 5 分钟至 24 小时。智能刷新在有新文章时缩短间隔、无新文章时延长，首次和手动抓取不调整学习结果。规则与上次尝试时间持久化，重启后恢复；错过多个时刻只补抓一次，再计算后续时间。已登记自有源的 XML 与广场预览共用抓取规则，固定 XML 后台调度会跳过这些源。未登记的公开 query 组合沿用 10 分钟后台调度；私密自有源也按规则自动生成 XML，订阅读取仍要求有效凭证；选择仅手动可停止自动抓取。XML 由后台按抓取规则或由管理员手动生成，永久持久化，无过期时间，也不参与普通缓存的容量淘汰。公开及私密订阅的 `/rss`、`/atom` 请求在已有 XML 时直接读取；尚未生成时，首次访问创建后台生成任务，并立即返回 503「订阅源 XML 正在生成，请稍后重试」（`FEED_GENERATING`，`Retry-After: 5`）。相同地址及归一化 query 的 RSS/Atom 并发访问共用一个任务，生成期间均返回正在生成；成功后直接返回 XML，失败后释放任务，下次访问可重试。私密源创建任务前仍需通过鉴权。后台更新失败时继续提供上次成功生成的 XML。下次抓取时间只用于调度，不影响当前 XML 是否可读。私密源仅保存抓取状态与内容指纹，不保存或发布文章预览，外部私密源的快照由上游管理。后台「强制刷新快照」可立即更新单个源，包括仅手动模式。每份快照保存最近 3 篇文章、封面地址及实际宽高，前端按比例占位；图片尺寸读取失败仍保留文章和封面。抓取失败保留上次成功快照，到下一次规则时间再试；编辑源地址、切换 token 访问要求或删除源时清理旧快照。封面只读取前 64 KiB，支持 PNG、JPEG、WebP、GIF，其他格式使用默认比例。

XML 在脚本、Cookie、授权或订阅源配置变更后仍保留，配置变更只使普通临时缓存失效；后台移除定时任务也不删除 XML。已有 XML 只在下一次成功刷新时覆盖，访问继续按当前路由状态和权限校验。

自有订阅的 feed JSON、RSS XML 和 Atom XML 作为同一份快照保存在 `API_STORAGE` R2 桶的 `rss/snapshots/` 目录，SQLite 的 `rss_route_cache` 只保存对象指针、生成时间和大小等元数据；调度信息仍保存在 SQLite。热点请求从内存读取，冷请求读取 R2，并合并同一对象的并发读取。每次刷新先上传独立对象，成功后再提交数据库指针；上传或数据库提交失败保留旧快照，成功替换后清理旧对象，清理失败仅记录日志。旧 SQLite 正文及分块继续可读，在下一次成功刷新时迁入 R2 并删除旧分块；仅手动源需手动刷新才能迁移。无 R2 绑定时沿用 SQLite；已经指向 R2 的快照需要原桶才能读取。普通脚本和保存前的临时预览仍按 TTL 存在 SQLite。

| 路径 | 功能 |
| --- | --- |
| `/` | 订阅广场 |
| `/admin/`、`/admin/discovery`、`/admin/scripts` | 管理后台与 SPA 子页面 |
| `/admin/auth/*`、`/admin/api/*` | 管理员会话与管理 API |
| `/rss/*`、`/atom/*`、`/mcp` | 订阅输出与 MCP 接口 |
| `/api/catalog`、`/api/sources`、`/api/search`、`/api/preview`、`/api/avatar/*` | 广场 API |

`server/` 保留共享 API 的领域、仓储、服务和 HTTP 分层。项目使用一份 `package.json`、lockfile 和 Wrangler 配置；`index.js` 分发 admin、discover 和 API 请求，HTTP/API 模块直接放项目根目录，通过函数调用 `server/` 内的业务服务；管理会话、Bearer Token 与 WebSocket Origin 校验继续保留。

```bash
# 本项目根目录，Node.js 22.19+
npm ci
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填写必需的 ADMIN_PASSWORD（无默认值）
npm run dev
npm run build
npm test
npm run dry-run
npm run deploy
```

也可以在本目录执行 `npm ci` 后使用 `npm run build|dev|test|dry-run|deploy`。`npm run build` 构建两个页面模块和共享静态资源，输出 `dist/assets/`；Wrangler 从 `index.js` 打包服务端与 QuickJS WASM。只将 `dist/assets/` 提供给 ASSETS；后端 bundle、WASM 和源码不作为静态文件公开。

## 网站与构建结构

- `index.js` 是唯一 Worker 入口，导出 `APIDurableObject` 并接入 `router.js`。
- `router.js` 分发前台、后台和现有 API；内部 DO 路径不对公网开放，自定义脚本图片路径保留回退。
- `api.js` 负责设备、RSS/Atom、MCP 和管理业务接口。
- `durable_object_router.js` 处理 DO 内部请求；`socket_hub.js`、`*_socket.js` 处理 WebSocket。
- `admin.js` 负责管理员登录、Cookie 会话、后台 API 入口和后台页面映射。
- `discover.js` 负责前台页面和目录、搜索、预览、头像接口。
- `server/infra/discovery_home.js` 负责首页 SSR，复用 `discover/index.js` 的视图与页面模板。
- `public/` 只保存公共资源：品牌、平台图标和通用样式。前台业务源码在 `discover/`，后台业务源码在 `admin/`；HTML、业务 JavaScript、业务样式与页面 manifest 均不放入 `public/`。
- 前台仅保留首页，路由声明、首页模型、全部视图和浏览器挂载集中在 `discover/index.js`，Model 与 View 在文件内分别维护。后台用 `admin/store.js` 集中声明路由。后台 `pages/` 按 `xx.js`（视图）与 `xx.model.js`（状态、请求及业务行为）配对，`components/` 保存共用视图；菜单从路由声明生成。
- `scripts/` 集中保存统一构建、前后台 bundle 构建、Timeless 插件及 RSS 示例同步工具；npm 命令从这里启动。
- `public/assets/` 保存共享依赖和 Timeless 浏览器适配模块；`public/brand/` 保存唯一品牌源文件。

`scripts/build.js` 负责启动构建所需的 API 并等待就绪，再异步执行 `scripts/build_frontend.js`；开发与构建通过 `scripts/local_worker.js` 共用 Worker 启动和清理逻辑。前端构建复制 `public/` 的公共资源，前后台脚本分别从 `discover/`、`admin/` 构建业务文件并写入同一临时输出，全部成功后原子切换为 `dist/assets/`；主 Worker 由 Wrangler 直接打包，不预生成 Go 嵌入用的服务端 bundle。前台静态文件在资源根路径，后台静态文件在 `/admin/`，依赖在 `/assets/`，品牌在 `/brand/`；旧图片地址保留构建别名，兼容已发布 R2 首页和 manifest。前台引用 `/base.css`；后台 `admin/style.css` 只维护单属性原子类，具体尺寸在页面 `style` 中声明，组件内部样式通过参数传入；后台 manifest 从同一份 `discover/site.webmanifest` 生成，只覆盖展示名称。

`wrangler.jsonc` 是唯一部署配置。静态资源由 Workers Static Assets 分发，动态页面和 API 使用 `run_worker_first`；不启用全站 SPA 回退，后台已登记页面才映射到 `/admin/index.html`。`server/lib/site_security.js` 同时定义动态响应和构建生成的静态 `_headers` 策略，保留 `manifest-src 'self'`。

本项目不使用 Go CLI、Go 嵌入产物或 Pages 部署。Go API 服务、设备客户端是仓库中的独立实现，不参与本项目构建。

生产 secret 使用 Wrangler secret，真实值不写入源码。必需值为 `ADMIN_PASSWORD`；Device Token 在后台「设备管理」创建，可设置备注、有效期、撤销和按需查看明文，旧 `DEVICE_TOKEN` 会自动导入。中央账号会话签名优先用 `READER_SESSION_SECRET`，未配置时依次回退旧 `DEVICE_TOKEN`、`ADMIN_PASSWORD`。Cookie 推送凭据按所用功能配置。首次部署需创建配置中的 R2 桶 `findrss-storage`。

`/admin/discovery` 新增或编辑订阅源时，`/rss/`、`/atom/` 地址必须匹配 `kind: rss` 的脚本路由，地址智能提示也只列出这类脚本的路由。普通外部订阅地址沿用原校验。

列表右上角“导出 JSON”下载所有订阅源（包括停用源），不受分页、关键词、平台或状态筛选影响，格式为 `{ "sources": [...] }`。源地址保留 `{{hostname}}` 模板；文件包含源配置与元数据，不含缓存状态或文章快照。

添加订阅源时，自动读取的头像和手动上传的头像都会在保存时持久化到 `API_STORAGE` R2 桶（`discovery/avatars/` 前缀），展示使用本站 `/api/avatar/<id>?v=...` 地址，不依赖上游图片链接。替换、移除头像或删除源会清理旧对象；清理失败记录日志，不回滚已提交的操作。旧 SQLite 头像继续可读，重新上传后改存 R2；没有 R2 绑定的环境沿用 SQLite。上游拒绝下载时可手动上传头像。

`FINDRSS_HOSTNAME` 是订阅地址中 `{{hostname}}` 的实际 origin。留空时使用当前请求的 origin，可同时通过 workers.dev 域名和自定义域名访问；需要固定订阅域名时再配置此变量。Worker 会将访问 origin 传递给 Durable Object，手动刷新快照使用本次请求的 origin，发现页定时快照刷新使用持久化保存的最近一次访问 origin。

`/admin/scripts` 的新增与编辑表单使用全屏三栏：左侧代码，中间对话，右侧调试。Debug 为每条路由显示一行路径输入框和「运行调试」按钮，默认填入该路由的 example，可编辑路径及 query；`/debug` 是固定前缀，不出现在输入框中，调试和脚本助手提交请求时统一添加。修改草稿后通过管理员端点 `POST /admin/api/scripts/routes` 编译读取路由元数据，不调用 handler，已有路由保留各自输入。点击对应按钮按地址匹配当前草稿的路由和 params/query；⌘/Ctrl + Enter 与实时调试使用当前选中的路由。首次运行后，「实时调试」会在停止编辑 800ms 后重新执行；执行期间的修改只补跑最后一份草稿。`POST /admin/api/scripts/debug` 仅允许管理员访问，使用真实抓取与授权 Cookie，不保存草稿、不读写公开响应缓存，返回与 `/debug` 相同的上下文、上游请求、日志、完整输出和错误堆栈。链接主机不作为抓取目标，query 中的 token 不传入脚本。原「Mock 测试」仍走独立的 `/scripts/test`；表单不再显示 Mock 路由序号；「保存后开放 /debug」只控制保存后公开路由的 Debug 配置。

新增脚本默认「保存草稿」，允许保存未完成代码；「发布正式」会重新校验模块及全部路由冲突，再开放启用中的路由。发布必须显式传入 `version`，格式严格为 `1.0.0` 三段数字，不允许前导零或预发布后缀，每次发布都须高于该脚本上次正式版本；直接修改正式脚本的源码或版本号也按发布校验。列表展示版本号，旧脚本显示「未编号」，下次发布需填写版本；列表「发布正式」会打开编辑器填写版本号。草稿版本可以留空，退回草稿仍保留上次正式版本作为递增基准。启停和 Debug 开关不升级版本。`metadata_json` 保存 `version`、`published_version` 和当前源码的 SHA-256 `script_hash`，无需新增数据库列。Cookie 授权同时绑定版本号、精确源码哈希及权限范围，改代码或升级版本都要重新确认；确认下一版的授权不会提前替换在线版本的授权。`POST|PATCH /admin/api/scripts` 接受 `status: "draft" | "published"`；PATCH 未传状态时保留当前状态，POST 未传状态时按正式处理并要求版本号。退回草稿保留代码并立即撤下路由、清空响应缓存；草稿不占用数据库的 `path` 唯一索引，实际路由声明仍保留在 metadata 中。这是单一版本状态切换，不保留同时运行的旧正式版本。

脚本统一使用 `script` 命名：管理 API 为 `/admin/api/scripts`，旧 `/admin/api/rss-scripts` 前缀仍兼容相同鉴权与行为。DO 启动时在事务内将旧 `rss_scripts`、`rss_script_logs`、`rss_script_agent_settings` 表原地改名为 `scripts`、`script_logs`、`script_agent_settings`，保留脚本、日志和加密模型密钥；迁移可重复执行，回退旧版前需恢复旧表名。结构化日志事件改为 `script.exec`。`RSSScript` 仍是 RSS 类型的基类，`HotRankScript`、`kind: "rss" | "hot"`、`/rss` 与 `/atom` 地址继续沿用。

Cloudflare Worker 改名会创建新的 DO 命名空间：已有生产数据需要保留原 Worker 名部署，或先安排数据迁移。当前 DO 类名为 `APIDurableObject`，R2 桶名为 `findrss-storage`；已有部署升级前需安排 DO 类名迁移和旧桶数据迁移，并将原管理密钥以相同值配置为 `ADMIN_PASSWORD`，以保留已有加密凭证的解密能力。

脚本卡片的 Cookie 状态使用与实际 RSS 请求相同的校验：存在授权 ID 不等于当前版本、源码与访问范围仍获授权。新增或调整公开订阅源后，原授权可能需要重新确认；卡片会显示「Cookie 需要重新确认」，点击「重新确认 Cookie 权限」可在当前版本上确认最新访问范围，无需升级版本或运行脚本。管理员检查端点为 `POST /admin/api/scripts/<id>/cookie-permissions`，只校验并返回确认信息，不执行 handler、不自动授权。确认后再刷新订阅源快照。

脚本工作区现在是「代码 / 脚本助手 / Debug」三栏。脚本助手 `XiaoxunScriptAgent` 只注册当前草稿的 `get_script_draft`、`edit_script_draft`、`debug_script_draft` 三个工具。点击中栏「大模型设置」，可管理厂商列表、API Key、模型配置、参数、启用开关和连接测试页面。可配置最多 16 个厂商、每厂商 32 个模型，并保留相同的内置厂商预设和自定义入口。中栏对话提供 ProseMirror 输入框与模型选择，左下角按厂商分组、搜索和切换模型；每轮请求携带准确的厂商与模型标识，所选项删除或停用时不会自动换到其他厂商。设置经管理员接口保存到 API DO 的 `script_agent_settings`，各厂商密钥分别使用 `ADMIN_PASSWORD` 派生的 AES-GCM 密钥加密，GET 不返回密钥；支持删除密钥，移除厂商会清理对应凭证；更新设置时 API Key 留空保留原密钥，轮换 `ADMIN_PASSWORD` 后需重新输入模型 API Key。

`GET|PUT /admin/api/scripts/agent/settings` 管理模型目录与密钥；`POST /admin/api/scripts/agent/test` 可在保存前使用草稿地址、参数和临时密钥测试连接；旧单模型配置自动转为默认厂商，保存目录时保留加密密钥。Workers AI 仅在部署注入 `AI` 绑定时可用；`GET /admin/api/scripts/agent/ws` 在当前管理员会话下传送流式回答、草稿修改和 Debug 结果。模型修改通过沙箱编译校验后立即更新左侧草稿，按版本拒绝过期结果；手动改代码或调试链接、停止对话或关闭表单都会取消当前运行。对话仅修改当前未保存草稿，不自动保存、发布或切换其他脚本。会话历史仅保留在当前编辑工作区，重新打开表单或刷新页面后开始新对话。单次运行最多 8 轮工具调用、3 分钟，API DO 最多同时运行 4 轮对话。

全局 XiaoxunAgent 与脚本助手 XiaoxunScriptAgent 每轮模型调用均注入同一份 [脚本 SDK 知识](../server/lib/script_agent_runtime_knowledge.js) 和 [feed JSON → XML 知识](../server/lib/script_agent_feed_knowledge.js)。SDK 知识覆盖 `@findrss/util` 各工具的签名和返回值、Result/parseJSON、RSSScript/HotRankScript、显式 Cookie 授权、日志与草稿发布约定，并包含经过真实 QuickJS 执行验证的 RSS、热榜和 Cookie 示例；共享知识不增加助手的操作权限。feed 知识说明顶层字段对应 RSS `channel`、`items` 数组对应 `item`，并列出 Atom 映射、字段类型、时间回退、HTML 转义、图片/多图/附件/动态照片格式及完整示例。RSS/Atom 订阅脚本必须直接返回含 `items` 数组的 feed 对象，不能再包 `channel` 或预先转为 XML/JSON 字符串；不支持的原生 RSS 字段名不会自动映射。`HotRankScript` 的普通路由返回榜单快照，不适用这份 XML 输出规则。示例由测试交给真实 `FeedModel` 渲染并解析验证，助手运行测试同时检查每轮请求携带这份知识。

管理后台所有页面右下角提供「小讯」全局对话入口，提供对话框、输入框和左下模型选择，与脚本助手共用大模型配置和加密密钥。`GET /admin/api/agent/ws` 仍需管理员会话，并拒绝跨站 Origin。每次发送携带当前管理路由和页面上下文；切换路由取消当前运行并清空上一页历史，对话窗口保持打开。上下文包含页面用途；Cookie 页只提供域名和数量，不提供密钥值。脚本页仍使用三栏编辑器中的助手实时改草稿和 Debug。

`/admin/discovery` 的全局助手可查询、新增、编辑和删除订阅源，使用现有 `ServiceDiscovery` 校验、重复地址限制、模板保存和头像清理。编辑/删除必须先读取真实记录，写入点检查读取后记录是否变更，冲突时要求重新读取；只修改用户指定字段，不覆盖缺省字段。成功操作经 `resource_changed` 事件刷新列表，保留其它未保存表单；删除正在编辑的源会关闭该表单。当前筛选、选中源和未保存表单通过页面适配器注入；其它页面不提供订阅源写工具，不允许模型伪造跨页面操作。
## 脚本平台、标签与维护者

平台使用 `{ name, icon }`，`icon` 支持完整 SVG 源码、无凭据的 HTTP(S) 图片地址或站内图片路径，可省略或留空。默认值为 `{ name: "网页", icon: "" }`，兼容旧字符串。可 `export const platform = { name, icon }` 供全部路由共用，或通过 `route.platform` 逐条覆盖。未提供图标时沿用内置平台图标，自定义平台默认显示地球 SVG，无需在脚本中重复内嵌。品牌示例脚本直接内嵌 `public/platform-icons/` 中对应的 SVG，无需额外导入图标文件。

正式版本通过版本号、路由及 Cookie 授权校验后，脚本与平台在同一数据库事务中保存。平台按名称去重，同名新图标更新旧图标；草稿和调试不注册平台。`platforms` 表为订阅广场、后台平台筛选 Select 和订阅源表单提供统一列表，不需要先添加订阅源。升级时回填已发布脚本，草稿不参与；删除脚本或退回草稿不会清除已经收集的平台。已有订阅源的平台继续保留，新增自有源按匹配的已发布脚本路由预填平台。

`maintainers` 支持多个 `{ nickname, url, avatar }` 对象，也可用 `name` 代替 `nickname`（如 `{ name: '作者', avatar: 'https://example.com/avatar.png' }），后台展示昵称、头像和个人链接。昵称必填，`url`、`avatar` 可留空，非空时必须是无用户名密码的 HTTP(S) 地址；旧字符串数组继续支持。

标签使用 `export const tags = ['科技', '文章']` 为所有路由设置默认值，`route.tags` 或 `routes` 中的 `tags` 可逐条覆盖，空数组表示不带标签。每条路由最多 13 个不同标签，每个标签去除首尾空白后为 1–32 字符，不含控制字符，按名称精确去重。标签保存在路由元数据中，不是 handler 返回值或 RSS 条目分类。

与平台一样，正式发布成功后在同一事务中聚合脚本标签到 `tags` 表，草稿、调试和失败发布不收集；重启时回填已发布脚本，删除或退回草稿不清除已收集标签。discover 和管理后台共用这份可选标签列表，不再补固定默认标签或从订阅源、旧分类聚合。新增自有源按匹配路由预填标签，可手动修改，修改源不会注册新标签。XiaoxunAgent 的共享知识和订阅源上下文包含这套平台、标签声明与选择规则；全局助手只能修改订阅源配置，脚本声明由脚本编辑器助手协助修改草稿，管理员发布后生效。

```js
export const route = {
  name: "知乎用户作品",
  path: "/zhihu/people/:id/:kind?",
  tags: ["文章"],
  platform: { name: "知乎", icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>' },
  maintainers: [
    { nickname: "findrss", url: "https://example.com/", avatar: "https://example.com/avatar.png" },
    { nickname: "另一位维护者", url: "", avatar: "" },
  ],
  handler: ctx => script.run(ctx),
};
```

## 声明和填写脚本配置

在模块中导出 `config_schema`，脚本卡片会显示「配置」按钮，点击后按 Schema 生成表单，保存的值在 handler 中通过 `ctx.config` 读取。配置按脚本 ID 保存，多条路由共用，正式执行、草稿 Debug、媒体预览和 Mock 测试均读取同一份值；新脚本调试使用默认值。示例：

```js
export const config_schema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: { type: "string", title: "订阅源名称", minLength: 1, default: "我的订阅" },
    limit: { type: "integer", title: "条目数量", minimum: 1, maximum: 100, default: 20 },
    full_text: { type: "boolean", title: "抓取全文", default: false },
    language: { type: "string", title: "语言", enum: ["zh-CN", "en"],
      enumDescriptions: ["中文", "英文"], default: "zh-CN" },
    api_key: { type: "string", title: "API Key", writeOnly: true, description: "可选的接口凭据" },
  },
};
export const route = {
  path: "/configured-feed", name: "可配置订阅源",
  handler(ctx) {
    return { title: ctx.config.title, link: "https://example.com/", language: ctx.config.language,
      items: [] };
  },
};
```

支持 `string`、`number`、`integer`、`boolean`、嵌套 `object` 和 `array`；枚举生成选择框，布尔值生成开关，数组使用 JSON 文本框。字段可设置 `title`、`description`、`default`、`enum`、`enumDescriptions`、`writeOnly`；校验支持 `required`、`additionalProperties`（布尔值）、`minLength`、`maxLength`、`pattern`、`minimum`、`maximum`、`minItems`、`maxItems` 和 `items`。根类型必须为 object，各对象需声明 properties，数组需声明 items，最多嵌套 8 层。暂不支持 `$ref`、组合和条件 Schema；不支持的关键字会在编译时报错。

`PATCH /admin/api/scripts/<id>` 接受 `{ "config": { ... } }`，替换配置并填入缺省值，服务端校验失败返回 400，不覆盖已保存值。配置保存不升级脚本版本，更新代码、启停、草稿状态切换保留配置；保存后清空脚本响应缓存。新增必填字段而无默认值时，可先保存代码，再从卡片补填；未补填时执行会报告配置错误。

配置上限 32KB，保存在现有 `metadata_json` 中，无需数据库迁移。`writeOnly` 仅遮挡输入，不加密存储，也不阻止管理员重新读取；不要把凭据写入 Schema 默认值、脚本输出或日志。

## 脚本 Result 与 JSON 解析

QuickJS 全局注入 `Result`、`BizError` 和 `parseJSON`，结构参考 Timeless `packages/base/src/result`：`Result.Ok(data)` 返回 `{ data, error: null }`；`Result.Err(message, code?, data?)` 返回 `{ data, code, error }`，其中 `error` 是包含 `message`、`messages`、`code`、`data` 的 `BizError`。判断成功使用 `result.error === null`，不能用 `data` 的真值判断（JSON 的 `null`、`false`、`0` 都可成功）。

`parseJSON(text, reviver?)` 捕获 JSON 语法和 reviver 错误并返回 Result。原生 `JSON.parse` 保留 JavaScript 原有语义，脚本应使用 `parseJSON`。`ctx.fetchText`、`ctx.invoke`、`ctx.cookies.get` 返回 `Promise<Result>`；`ctx.fail` 返回失败 Result，调用后应 `return`。基类的 `fetch`、`run` 和 `RSSScript.timestamp` 也使用 Result；子类捕获自身可能发生的异常并转成 `Result.Err`。

```js
export const route = {
  path: "/demo/json", name: "JSON 示例",
  async handler(ctx) {
    const fetched = await ctx.fetchText("https://example.com/data.json");
    if (fetched.error) return fetched;
    const parsed = parseJSON(fetched.data);
    if (parsed.error) return parsed;
    return Result.Ok(parsed.data);
  },
};
```

宿主只在路由出口展开一层成功 Result，再执行正文或 RSS/Atom 校验；失败 Result 保留错误代码、日志及堆栈并映射到原有 HTTP 错误响应。脚本可处理错误并返回回退结果。直接返回普通路由内容仍受支持。旧脚本文件没有自动改写：旧的接口调用需迁移为先检查 `.error`、再读取 `.data`；迁移 Cookie 脚本后需对新的源码版本重新授权。

## 内置工具模块

脚本通过 `import { utils } from '@findrss/util';` 使用公共工具，源码集中在 [script_util.js](../server/infra/script_util.js)。该虚拟 ES 模块在 QuickJS 编译、后台调试和正式执行时可用，无需安装 npm 包；模块加载仅允许这个名称，不读取宿主文件或下载代码。`utils` 是冻结的无状态对象，不提供原示例中的 `source`、`main`。

```js
import { utils } from '@findrss/util';

export const route = {
  path: '/demo/util', name: '工具示例',
  async handler(ctx) {
    const fetched = await utils.request_json(ctx, 'https://example.com/data.json', {
      headers: { Referer: 'https://example.com/' },
    });
    if (fetched.error) return fetched;
    const list = utils.array_at(fetched.data, 'data.items');
    if (list.error) return list;
    return Result.Ok(list.data);
  },
};
```

| 工具 | 返回值与用途 |
| --- | --- |
| `decode_entities(value)` / `decode_html(value)` | 字符串；解码常见 HTML 实体和数字实体，非法码点保留原文 |
| `plain_text(value)` / `escape_html(value)` | 字符串；提取文本或转义 HTML，不用于清洗可执行 HTML |
| `absolute_url(value, base)` | `Result<string>`；拼接 HTTP(S) 相对地址，拒绝其它协议、用户凭据与非法字符；相对地址必须显式传 base，空值返回空串 |
| `timestamp(value)` | `Result<number \| undefined>`；秒、毫秒或日期转为毫秒，缺失返回 undefined，无时区的年月日格式按北京时间处理 |
| `identity(value)` / `array_at(value, path = '')` | `Result<string>` / `Result<Array>`；校验稳定 ID 或按点分路径取得数组；数字 ID 必须是安全整数 |
| `request_text(ctx, url, options)` / `request_json(ctx, url, options)` | `Promise<Result>`；复用 `ctx.fetchText`，后者再调用 `parseJSON`，透传请求和解析错误 |
| `embedded_json(text, marker)` | `Result`；在正则 marker 后扫描 JSON 对象或数组，不执行页面代码 |
| `document_nodes(text, xml = false)` / `rows(root, selector)` | `Result`；轻量 HTML/XML 节点解析或取得非空列表；XML 拒绝 DOCTYPE |
| `descendants(root)` / `matches(node, selector)` / `select(root, selector)` | 数组 / boolean / 数组；遍历及匹配节点，未命中 select 返回空数组 |
| `text_of(node)` / `first(root, selector)` / `field(root, selector)` / `attribute(root, selector, name)` | 文本 / 节点或 undefined / 文本 / 属性字符串；文本或属性未命中返回空串 |
| `feed_items(xml, base)` | `Result<Array>`；读取常见 RSS/Atom 条目的稳定 ID、链接、正文、原始日期和缩略图，不补日期 |
| `map_results(array, mapper)` / `replace_results(text, pattern, mapper)` | `Result<Array>` / `Result<string>`；同步回调返回 Result，提取 data 并传播失败，避免 Result 混入条目或 HTML |
| `parseJSON(text, reviver?)` | `Result`；与全局 parseJSON 相同 |

节点选择器沿用旧示例的轻量实现，只支持标签、ID、class、属性存在/等于/前缀/后缀、后代与直接子节点，属性值不支持空白；不是完整 DOM/CSS 或严格 XML 校验器。请求工具提供基础 Accept、Accept-Language、User-Agent，允许 headers 覆盖，Referer 和 Cookie 句柄需脚本显式提供，Cookie 授权仍由宿主验证。JSON 请求不猜测各网站业务错误字段，脚本需自行校验接口回包。

[两个类示例](../examples/script-classes/) 已使用这个模块；69 个旧示例已按文件顶部 `/** RSS */` 标记重写到 [examples/rss](../examples/rss/)（17 个）和 [examples/hot](../examples/hot/)（52 个）。旧 `examples/scripts` 保持原样，新目录不会自动导入后台。

## 内置脚本基类

QuickJS 在编译、调试、Mock 测试和正式执行前将 `RSSScript`、`HotRankScript` 注入全局，脚本可直接通过 `class WechatChannelsRSS extends RSSScript {}` 或 `class BaiduHotRank extends HotRankScript {}` 继承，无需 import 或复制基类。子类实现 `async fetch(ctx)` 返回 Result，路由的 `handler` 返回实例的 `run(ctx)` 结果；每次执行使用独立沙箱，修改基类不会影响其它脚本。

`RSSScript` 校验 feed 和条目，归一化真实发布时间、按发布时间倒序排列并按稳定 ID 去重，返回可用于 `/rss`、`/atom` 的 feed JSON。缺失发布时间不使用采集时间补齐。条目的多图、动态照片、附件、媒体类型和 `extra` 字段会保留，源的 `id`、`extra` 与真实 `updated` 也会保留。

`HotRankScript` 校验榜单和热度，置顶项在前。非置顶排名为上游正整数，未知时使用 `null`；全部排名已知时按排名排列，有未知排名时保留上游次序。热度缺失为 `null`，不从列表下标或采集时间伪造数据。返回 `{ kind: "hot_rank", observed_at, entries, ... }` 榜单 JSON；此结果不含 `items`，使用普通路由访问，不通过 RSS/Atom 包装器。

管理页 `/admin/scripts` 用 Hot / RSS Tabs 作为标题，筛选、数量和列表按 `kind` 展示对应类型。列表接口支持 `GET /admin/api/scripts?kind=hot|rss`，省略时返回全部。新增 Hot 使用百度热榜 HTML 示例，新增 RSS 使用 Solidot RSS 示例。模块可导出 `kind = "hot" | "rss"`，兼容旧 `script_type`；未声明时优先读取顶部 `/** HOT */` / `/** RSS */` 标记，再识别基类。迁移前无标记的 NewsNow 示例兼容归为 Hot，其余旧脚本默认 RSS。类型随草稿保存、发布、回退和列表响应保留；Hot 卡片提供普通路由地址。

示例见 [百度热榜](../examples/script-classes/baidu_hot_rank.js) 和 [微信视频号](../examples/script-classes/wechat_channels_rss.js)。旧脚本仍可声明自己的同名局部类。

## 脚本 Cookie 授权

`ctx.fetchText()` 默认匿名，宿主不再按 URL 自动注入 Cookie，也不接受脚本直接填写 `headers.Cookie`。现有脚本文件不会自动改写或获得授权；依赖登录的旧脚本需逐个迁移。Cookie 同步和管理页面仍是管理员共享的凭据库，订阅者不能代替管理员授权。

模块显式声明权限，然后取得仅本次执行有效的句柄：

```js
export const permissions = {
  cookies: [{
    id: "weibo_session",
    origin: "https://weibo.com",
    path_prefix: "/ajax/",
    names: ["SUB", "XSRF-TOKEN"],
    purpose: "读取登录后可见的微博列表，并完成 CSRF 校验",
  }],
};

export const route = {
  path: "/demo/weibo/:uid", name: "微博列表", example: "/demo/weibo/123",
  async handler(ctx) {
    const session = await ctx.cookies.get("weibo_session");
    if (session.error) return session;
    ctx.log("使用的 Cookie 名称", session.data.names);
    const text = await ctx.fetchText("https://weibo.com/ajax/statuses/mymblog?uid=" + encodeURIComponent(ctx.params.uid), {
      cookies: session.data,
      cookie_headers: { "x-xsrf-token": "XSRF-TOKEN" },
    });
    if (text.error) return text;
    const parsed = parseJSON(text.data);
    if (parsed.error) return parsed;
    const body = parsed.data;
    if (!Array.isArray(body?.data?.list)) return ctx.fail("UPSTREAM_FETCH_FAILED", "微博没有返回列表，请检查登录状态");
    return Result.Ok({ title: "微博 · " + ctx.params.uid, link: "https://weibo.com/u/" + ctx.params.uid,
      items: body.data.list.map(item => ({ id: String(item.idstr || item.id),
        title: item.text_raw || "微博", content: item.text || "", published: item.created_at,
        link: "https://weibo.com/" + ctx.params.uid + "/" + item.bid })) });
  },
};
```

首次调试或发布弹出管理员确认窗口，显示名称、用途、origin、路径、源码 SHA-256 和输出访问范围。草稿无需授权即可保存。授权绑定脚本 ID、完整源码、规范化权限和当前公开源范围；任一变化需重新确认。未保存的授权有效期为 15 分钟，保存后绑定到新脚本。Cookie 值轮换不要求重新授权。沙箱只能看到句柄和声明的名称，不能读取值；派生请求头也由宿主生成，必须引用已授权名称。

宿主继续检查 Cookie 的 domain、hostOnly、path、Secure 和有效期；请求还必须命中授权的 HTTPS origin 和路径范围。为避免路径解释差异，带百分号编码的 pathname 不发送授权 Cookie。跨 origin 或离开授权路径的重定向移除凭据，后续返回原地址也不会恢复。Mock 测试不提供真实 Cookie 句柄。Debug 的「上下文」Tab 展示获取及发送的权限 ID、名称和不带 query 的地址，均不含值。

脚本卡片可「撤销 Cookie 授权」，立即清空响应缓存。每次路由请求在缓存读取前校验授权，每次 Cookie 使用及执行结束也重新校验；撤销阻止后续访问和结果入缓存，已发送的上游请求无法撤回。已被订阅者下载或缓存的内容不能收回。

此授权接口当前由 `findrss-worker` 提供。
