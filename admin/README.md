# FindRSS 管理后台模块

本目录是纯前端模块，由 `findrss-worker/index.js` 所在的主 Worker 提供页面与接口。统一安装、启动与部署见 [Worker README](../README.md)。


完整的部署、初始配置和后台使用说明见[安装与配置指南](../docs/setup.md)。

本目录保存管理后台模块，所有页面位于同一个 Worker 的 `/admin/`。

业务源码按 `pages/`、`components/` 拆分；每个页面使用 `pages/xx.js`（View）与 `pages/xx.model.js`（Model）配对，模型维护状态、请求、校验和业务行为，视图只渲染并调用模型方法。`store.js` 集中声明路由、生成导航菜单并实现认证初始化、会话检查、登录、退出和鉴权请求，`app.js` 是浏览器入口，测试在 `__tests__/`。根构建从 `public/` 复制公共资源，生产构建由 `scripts/build_admin_ui.js` 打包后台文件，开发模式由 `scripts/admin_dev.js` 准备 ES modules，两者直接写入同一个临时资源目录；不再单独复制或构建 `admin/dist/`。两站共享品牌与 manifest 基础配置。后台 `style.css` 只声明单属性原子类；具体尺寸在页面的 `style` 中维护，响应式原子类通过显式传入的 CSS 变量调整同一个属性。组件与页面统一使用原子类；焦点、禁用和 ARIA 状态使用单节点原子变体，禁止业务类和父子选择器。共用组件的内部布局通过 `bodyProps`、`headerProps`、`listProps` 等参数传入；CodeMirror 通过 `wrapperStyle` 设置尺寸。

管理界面直接复用 `components/frui/` 的按钮、表单控件、Card 和 PageHeader，组件源码、主题 token 和 SVG 图标注册表全部保存在本目录；`style.css` 保存单属性原子类，`components/frui/tokens.css` 提供主题变量，输出为 `frui.css`。`admin/components/ui.js` 只接入宿主和兼容后台的事件形状，不引入阅读器账号或业务状态。`npm run dev` 启动时仅预打包 npm 依赖，通过 import map 和原生 ES modules 加载后台源码；开发入口确保共享 UI 就绪后加载页面，源码保存后原样同步到静态资源目录，刷新页面即可生效。开发资源禁用缓存，import map 仅通过开发专用 CSP 哈希放行；监听会随开发服务退出而关闭。`npm run build` / 部署仍由 `scripts/build_admin_ui.js` 使用 esbuild 打包源码。两种模式共用 `public/assets/timeless/0.34.2/` 的 Timeless Core/DOM，依赖由统一项目安装，产物不依赖运行时访问阅读器站点。

## 请求结构

每个后台标签页共用 `/admin/api/events/ws` 一条 WebSocket，消息通知、设备与日志、测试及下载任务、订阅源、剪藏、后台任务和概览通过主题订阅更新；全局助手与脚本助手也复用该连接的独立逻辑通道。页面首次打开、手动刷新、相关变更通知和断线恢复时才读取原有 API，不再定时轮询；离开页面取消对应订阅。服务端合并 200ms 内的变更，只发送主题和记录 ID，广播本身不查询数据库，空闲连接使用 Durable Objects WebSocket 休眠。助手断线会终止当前回合，不自动重放操作。

非浏览器集成检查：`node --test scripts/admin_realtime_smoke.test.mjs`，使用隔离的本地 SQLite / R2 验证会话、来源校验、变更通知和助手通道复用。

`/admin/detections` 提供内容检测任务：选择已发布启用的 Detect 脚本及具体路由、设置周期、手动执行、暂停、重置基线和查看历史。脚本管理增加「内容检测」Tab，Debug 可填写上次内容快照 JSON；脚本中的 fetch → normalize → compare 比较网站数据。结果区分首次、无变化、有变化、无法可靠判断和采集失败，历史展示正文、字段、列表条目、相对顺序及规则命中。窗口列表只报告进入/离开窗口；部分采集不判删除。每条任务独立保存基线，历史保留最近 20 次及当前基线，较大的结果存于 R2；任务编辑、取消、来源停用或授权撤销后不发布迟到结果。详见 [Detect 脚本契约](https://github.com/ltaoo/findrss-scripts/blob/main/detect/README.md)。

`/admin/clips` 通过已发布且启用的 `kind="clip"` 平台脚本采集内容：选择脚本及具体路由、设置刷新策略，再预览或复制 iframe。脚本管理增加「剪藏」Tab，复用导入、配置、Debug、权限、发布及版本流程，Debug 支持隔离的 HTML 预览。平台脚本用 `ClipScript` 返回 `{ title, link, html, stats? }`；`ctx.clip.capture` 提供共享节点提取、样式冻结和图片内嵌，使用时需要 `BROWSER` 绑定；也可使用 `ctx.fetchText` 生成 HTML。详见 [Clip 脚本契约](https://github.com/ltaoo/findrss-scripts/blob/main/clip/README.md)。旧手动记录自动关联通用网页脚本，保留原有 URL、选择器、视口、刷新规则、公开链接及快照。公开 `/clips/<ID>` 只返回清理后的静态快照，允许 iframe 嵌入；失败、脚本停用、授权撤销或迟到结果不会替换旧快照。

后台公共 Shell 挂载共享的 `Toaster()` 和 `TooltipHost()`。各页点击说明按钮通过 `FindRSSAdminUI.notify(text)` 展示提示，错误提示可传入 `{ error: true }`。通知支持关闭、自动消失，并在切换页面或卸载时清理。Field 的 `tooltip` 参数继续使用点击提示。

`/admin/discovery`「抓取与快照」列中，XML 抓取和广场快照失败时间旁的 `info-circle` 图标，以及「下次抓取」旁的 `circle-help` 图标，均使用 `Tooltip` 组件。实现参考小讯阅读器的共享会话、Portal 和 Popper，悬停或键盘聚焦显示完整错误原因或抓取规则（含继承后的有效规则），点击或 Esc 收起，通过 `aria-describedby` 关联提示内容，不触发 Toaster，也不叠加原生 `title` 提示。浮层沿用 `--frui-color-surface-raised`、`--frui-color-text`、`--frui-radius-sm` 和 `--frui-shadow-card`。

HTML 先通过 script 标签加载 Timeless 全局运行时。`components/ui.js` 首先导入 `store.js`，将 `vm`、`kit`、`ui` 命名空间挂到全局，再导入 `components/icons/index.js` 注册本地图标，组件直接使用 `vm.DialogCore`、`kit.RequestCore` 等。

```text
Browser
  ├── /admin/login.html ── 登录表单
  ├── /admin/index.html, /admin/app.js, /admin/style.css ── Worker ASSETS
  ├── /admin/auth/* ── 管理 HTTP 边界 登录与会话接口
  └── /admin/api/* ── 主 Worker 管理路由 ── 直接调用 API 处理函数
```

主 Worker 的 `admin.js` 提供后台登录、会话和页面路由；本目录没有 Worker 入口。登录表单只需输入密码，请求只提交 `password`；后端固定使用用户名 `admin`，密码来自 Worker secret `ADMIN_PASSWORD`；验证成功后签发 12 小时有效、`HttpOnly`、`SameSite=Strict` 的签名 Session Cookie。各管理页在 `beforeReady` 阶段检查当前路由是否需要登录，未登录时通过 `location.replace` 进入登录页；会话失效或主动退出也会回到登录页。代理管理 API 时，管理 HTTP 边界 在服务端注入管理员 Bearer Token，不向浏览器暴露 Secret。

`POST /admin/api/hot/snapshot` 可提交全部内置 Hot 示例的 JSON 快照更新及 rank HTML 重建任务，接口接受后台会话或管理员 Bearer/Basic 凭证，立即返回 HTTP 202 和 `{ task_id, task }`。JSON 保存完成后继续生成并发布完整 HTML，此前任务保持进行中；HTML 发布失败也记录为任务失败。后台「任务」页 `/admin/tasks` 展示任务 ID、进行中、完成、失败及已终止状态，沿用实时通知和终止操作；错误原因保存在任务记录中。定时和手动提交合并正在运行的同类任务。调用示例和错误状态见 [排行榜说明](../rank/README.md)。

管理后台页面统一由 `components/shell.js` 承载：桌面端使用固定侧边栏，移动端切换为底部导航；各业务页面共用这套外壳、页头和组件样式。新增子页面时，先建立 `xx.js` 与 `xx.model.js`，再在 `store.js` 的 `routes_configure.admin.children` 中声明路径、页面、标题和图标，并让页面根 View 调用 `FindRSSAdminShell.Page({ page_id, title, description }, children)`，业务 View 作为 `children` 传入，并导出页面函数供路由绑定；页面不再通过 `window.FindRSSAdminPages` 注册或自行挂载。

页面布局由 `frui/PageLayout`、`PageHeader`、`PageContent` 共同负责：`PageLayout` 使用全部可用宽度，统一桌面 16px、窄屏 12px 的页边距，以及页头与内容之间的 12px 间距；`PageHeader` 只承载页面标题、数量和全局操作，操作区根据可用空间换行；`PageContent` 承载筛选、Tabs、列表及业务工作区，区块间距默认 12px。布局复用 `--frui-space-*` 和控件高度 token，各页面不再添加外层限宽或整页留白。脚本页的类型 Tabs 和列表属于内容区，安装、新增按钮统一放入页头。加载占位也复用同一布局，避免进入页面前后边距变化。

“任务”页（`/admin/tasks`）展示最近 100 条后台任务及其状态、耗时和错误，进入页面时加载，通过“刷新”按钮手动更新。手动、定时及首次生成 XML 的快照刷新均记录任务；进行中的刷新可终止，已保存的快照继续可用，下次定时刷新仍按原计划执行。已下发且可能被其他刷新共享的设备调用继续按原租约结束，终止仅移除本次刷新对结果的等待。订阅源列表点击“刷新快照”后按钮保持加载，完成后更新该条记录；接口另支持通过 `Prefer: respond-async` 返回 202 和任务信息。

订阅源列表在进入页面、翻页、修改每页条数及搜索筛选后，调用 `GET /admin/api/background-tasks?source_ids=id1,id2` 批量获取当前页的进行中任务，恢复“刷新快照”按钮的加载状态。该管理员接口接受 1–100 个逗号分隔的源 ID，返回 `{ tasks: [...] }`，每个任务包含 `source_id`，不受最近 100 条任务列表的限制。存在进行中任务时每 2 秒查询一次，任务结束后更新当前页快照和 XML 状态，离开页面停止轮询。

页面顶部的“补抓逾期 5 小时”按钮提交全部启用且下次抓取时间已逾期至少 5 小时的源，不受当前分页、搜索或勾选影响。仅手动及外部私密源不参与；从未抓取的源按创建时间判断逾期。运行中或已排队的源会跳过。任务按现有并发上限执行，完成或失败后继续处理后续排队源；页面显示提交与跳过数量，并恢复当前页运行中任务的加载状态。管理员接口为 `POST /admin/api/discovery/sources/recover-overdue`，返回 202 和 `matched_count`、`queued_count`、`skipped_count`；已提交表示进入后台队列，实际抓取结果可在“任务”页查看。

“网络测试”进入 `/admin/network`，通过管理员接口 `POST /admin/api/network-test` 直接从当前 Worker 发起 GET 请求。支持编辑网址、请求头键值行和 1–60 秒超时（默认 10 秒）。请求头可添加、删除，名称和值均可编辑；完全空白行忽略，空值保留，无效名称、重复名称（忽略大小写）和含换行或空字符的值禁止提交。修改有效 HTTP(S) 网址后自动填入 Referer（移除 URL 片段，已删除时补回），仍可手动覆盖。测试结果展示逐跳重定向状态、每跳响应头耗时、总耗时和响应头。文本正文最多读取 64KB，在只读 CodeMirror 中按响应 Content-Type 格式化、高亮 HTML、JSON（包括 `+json`）、JS、CSS，其他文本不高亮；无效或截断的 JSON 保留原文，JSON 大整数不会被重写。图片、视频、音频改用媒体预览，读取同次请求返回的完整字节（最多 16MB），通过 multipart 将诊断 JSON 和媒体文件一并返回，再由浏览器 Blob URL 展示，切换请求或离开页面时释放；播放器不另行请求原网址。超过媒体上限、其他二进制类型或 `Content-Disposition: attachment` 响应只展示文件名、类型、大小，大小取自 Content-Length，未提供时显示未知；支持 UTF-8 `filename*`。默认填入起点目录示例和桌面 Chrome User-Agent；复现脚本时请使用相同的网址和请求头。移动端 User-Agent 可能触发跨域跳转，原站点 Cookie 不适用于其他域名，最终进入游客页不能单独证明原 Cookie 失效。Cookie 区域按目标网址的域名筛选后台已保存的匹配域名（包含父域），默认勾选，支持手动取消；同域名下修改路径或刷新保留选择，切换域名重新默认勾选，提供刷新、读取失败重试及无 Cookie / 无匹配空态。最终响应及逐跳请求的状态码使用标签：2xx 绿色、3xx 黄色、4xx/5xx 与无响应红色，1xx 蓝色。`GET /admin/api/network-test/cookie-domains` 仅返回域名与数量，测试请求只提交 `cookie_domains`，Cookie 值由服务端读取；不接受手工 Cookie 请求头。离开页面清空勾选，返回时重新读取域名。目标及重定向均复用公网地址校验，仅允许 HTTP(S) 的 80 / 443 端口，最多跟随 5 次重定向；未勾选时匿名访问；每一跳根据所选域名、目标域、路径、hostOnly、Secure 和有效期重新匹配 Cookie，不会转发其他站点的 Cookie；跨域移除手动填写的认证头。部署后测量线上 Worker 出口，本地运行则测量本地出口。“开始测试”旁提供“复制 curl 命令”：通过管理员接口 `POST /admin/api/network-test/curl` 复用相同参数校验和 Cookie 匹配，生成当前 URL 的 GET 命令，包含实际请求头、匹配的已选 Cookie、超时及响应头输出，生成命令不请求目标网站，也不包含后台登录凭证。命令可粘贴到本机 POSIX shell 比较出口，保留已有测试结果；仅复现首个请求，不自动跟随重定向。命令可能包含站点登录凭证，勿公开分享。

网络测试的“执行位置”默认入口 Worker，也可选择“脚本宿主”：接口追加 `?execution=script`，由 Worker 中的脚本服务发起请求，从 D1 读取已保存的 Cookie，不执行 QuickJS。两种位置复用相同的请求校验、Cookie 匹配、传输与结果展示；结果的 `execution` 字段及页面摘要标明实际执行位置。“复制 curl”也使用所选位置解析参数与 Cookie，但生成的命令仍从本机出口访问。可用于对比入口 Worker 请求成功、脚本请求超时的情况；相同传输方式不保证两个执行位置有相同出口。

网络测试的“传输方式”默认 Fetch，也可选择 TCP（接口参数 `transport: "tcp"`），复用 [rss/bilibili.js](https://github.com/ltaoo/findrss-scripts/blob/main/rss/bilibili.js) 使用的 TCP 传输。复现时填写相同网址、请求头并选择对应 Cookie。TCP 使用 HTTP/1.1 和 `Accept-Encoding: identity`，沿用脚本端的响应及解压后 10MB 上限；TCP 传输会在返回前读取完整成功响应，页面耗时包含这段读取时间。TCP 模式导出的 curl 使用 `--http1.1` 及相同传输请求头，仍从本机出口访问。

每张设备卡片通过“日志”按钮打开右侧抽屉，并调用 `/admin/api/devices/:device_id/logs` 查看设备行为，保留天数以服务端返回值为准，Cloudflare Worker 当前查询最近 3 天。连接、心跳、调用、响应和系统事件均以结构化日志保存；抽屉支持分类、自动刷新、向前分页和详情展开。敏感字段记录前会脱敏，超大详情会截断。

“消息”进入 `/admin/messages`，汇总所有脚本的错误，包括订阅请求、测试运行与保存校验。Cloudflare Worker 的设备和脚本日志由 Workers Logs 托管，后台通过官方 API 查询最近 3 天日志；需要配置账户 ID、实际 Worker 名称和具备 Workers Observability Write 权限的服务端 API Token，详见[技术指南](../docs/technical-guide.md)。旧 SQLite 日志保留备份，不再读写；R2 只保存编号及删除边界。`/admin/api/messages` 按 `before_id` 分页；`/admin/api/messages/ws` 实时通知后台加载新消息，断线自动重连并补拉记录。消息显示脚本名称、路由、源码行列、错误堆栈、实际传入的 params/query 与日志；敏感参数脱敏。旧日志的包装行号标为“沙箱行号”，没有位置的错误不猜测行号。默认打开“未读” Tab，标记已读后消息从未读列表移至“已读” Tab，两边分别显示空态与历史分页。未读徽标与“全部标记已读”使用当前浏览器的本地已读位置。删除已读只在本应用隐藏，Cloudflare 原始日志按平台保留期过期。Cloudflare Worker 和 Go API 均支持消息接口。

订阅源列表的“强制刷新快照”立即重新生成完整 RSS/Atom XML，并更新快照状态，也适用于仅手动模式。公开源同时更新广场的三篇文章预览；私密源只更新订阅 XML，不发布文章预览。外部订阅地址的 XML 由上游管理。

XML、文章快照的抓取状态与广场首页静态发布结果分别显示。刷新接口即使首页发布失败，也会返回最新抓取状态，并通过 `catalog_error` 单独提示发布失败；已成功的抓取任务仍记录为完成，首页发布由后台自动重试。

「设置 → 快照抓取」配置默认规则，默认每 1 小时；每个源的新增/编辑表单可覆盖默认。支持按间隔、智能刷新、多个时间点、分时段、五段 Cron 和仅手动；多个时间点也可只填一个时间，实现每天指定时间抓取。定时规则可设置时区、星期；分时段每行填写 `星期 开始时间-结束时间 间隔分钟`，例如 `1,2,3,4,5 08:00-18:00 10`，支持跨午夜，时段外间隔为 0 时停止抓取。间隔为 5 至 1440 分钟。列表显示规则与下次自动抓取时间；规则随 JSON 导入导出保留。自动规则适用于启用的公开源和私密自有源。私密源只保存 XML 和抓取状态，不发布文章预览，订阅读取仍需有效凭证；选择仅手动可停止自动抓取。外部私密源的快照由上游管理。

订阅源、脚本和 Token 管理列表使用 Timeless `kit.ListCore` + `kit.RequestCore` 实现后端分页，每页可选 10、20、50 条，默认 20 条。接口接收 `limit`、`offset`，返回当前页与 `total_count`；筛选在后端完成，切换筛选或每页条数回首页，删除末页最后一项后回退到有效页。

侧边栏的“订阅源”进入 `/admin/discovery` 子页面。该页面调用 `/admin/api/discovery/sources` 新增、编辑、启停、排序和删除 RSS/Atom 订阅源；启用中的订阅源会出现在 Discovery 页面默认列表，并优先参与搜索结果。表单里的「需要 token 访问」复选框始终显示，不随地址形态隐藏；自有脚本源可填 `{{hostname}}/rss/<路由>` 或 `{{hostname}}/atom/<路由>`，登记校验与公开性匹配都不区分这两个前缀。列表里的 `{{hostname}}` 模板地址由 API 按本环境 `FINDRSS_HOSTNAME` 展开后返回（可直接打开），编辑时则回填存储原文，不会把模板固化成本环境地址。

订阅源列表提供「公开性：全部／公开／不公开」筛选，按 `require_token` 判断，可与搜索、来源、启停状态组合使用；筛选条件通过 `q`、`source_type`、`status`、`visibility` 传给后端。JSON 导出独立读取全部源，不受筛选和分页影响。

订阅源表单通过 Timeless `ArrayFieldCore` 支持增删多个「社媒主页」（`social_urls`，公开 HTTP(S) 地址数组），列表可分别打开、复制链接，JSON 导入导出保留全部主页。旧 `social_url` 自动作为第一项读取；该兼容字段始终返回第一项，空数组清空全部主页。构建自有脚本源 XML 时，按路由与归一化查询参数匹配已启用源，将第一项社媒主页写入 RSS 的频道 `<link>` 和 Atom 的 `<link rel="alternate">`；留空沿用脚本输出。保存配置后已有 XML 保留，下次成功刷新时更新。外部订阅地址只保存主页信息，其 XML 由原站提供。

列表页的「导入 JSON」弹窗可粘贴 JSON 或通过 FilePicker 拖拽、选择 `.json` 文件（最大 2 MB）。支持当前「导出 JSON」的 `{ "sources": [...] }` 格式及订阅源数组，每项至少含 `title`、`feed_url`；保留模板地址与源配置，仅新增并跳过已有及批内重复地址，不导入 ID、头像或快照。逐项复用新增接口校验与保存，失败保留已保存结果及剩余 JSON，可继续重试。


XML 默认持久保存，无需开启“不清理”选项。脚本发布、修改、删除、Cookie 变更、授权撤销以及订阅源配置变更都不删除已有 XML，仅在下一次成功刷新时覆盖。停用、删除脚本或撤销授权后仍按当前路由和权限拒绝访问；转为私密后仍需凭证。普通临时缓存继续随配置变更失效。

新增订阅源时，后台默认勾选「需要 token 访问」（非公开），API 未传 `require_token` 时也默认为 `true`；「每次访问消耗积分」（`credit_cost`）默认为 1，允许 0 到 1000000000 的整数。可取消勾选或显式传入 `require_token: false` 设为公开。自有源每次成功访问按该源配置扣费，包含 RSS/Atom 缓存命中；0 表示需要 token 但不扣积分。余额不足返回 402，XML 尚未生成或访问失败不扣费；后台刷新和同次访问中的设备调用不重复扣费。公开源免费，外部源遵循原站权限与计费。旧源默认消耗 1，编辑与 JSON 导入导出保留此配置。

“Token”子页面（`/admin/tokens`）调用 `/admin/api/access-tokens`，创建、立即过期和移除用户凭证。Token 可以留空自动生成（无 `api_call_` 前缀），也可以手动指定；用途或使用人可选填，还可成对填写 email + password 作为 Reader 的第二种登录方式。列表不显示脱敏 Token，点击「查看」通过 `/admin/api/credit-transactions?access_token_id=…` 打开该 Token 的积分消耗日志，按时间倒序展示扣费、退款和充值记录、积分变动及余额，支持刷新和加载更早记录。用户 Token 明文只在创建响应中出现一次并仅保存 SHA-256 摘要；密码使用随机盐和 PBKDF2-SHA-256 保存。

“设置 → Device Token”和“设备管理 → Device Token”共用管理界面，通过 `/admin/api/device-tokens` 管理多个设备接入凭证，支持名称、备注、有效期、最近使用时间和撤销。创建成功后自动获取明文并在弹窗展示，支持复制；关闭弹窗或离开设置页清除弹窗明文。列表默认不展示 Token 内容，管理员点击「查看明文」时才通过独立的 `POST /admin/api/device-tokens/:id/reveal` 接口获取解密结果，30 秒自动隐藏；撤销删除密文并断开关联连接。旧 `DEVICE_TOKEN` 自动导入，部署时不再必填。设备 Token 与用户 Token 分开保存；设备 Token 的加密副本依赖部署的 `ADMIN_PASSWORD`，轮换后台密码后应创建新设备 Token 替换原凭证。

`/admin/overview` 打开时读取 `/admin/api/overview` 的持久化快照，不轮询；「立即刷新」也只读取最新快照，不触发统计。DO alarm 每 5 分钟统计一次，覆盖设备、任务记录、用户 Token、脚本、订阅源、Cookie 数量，去重后的有效路由声明、来源和标签数量，以及每个订阅源的累计调用次数与总次数，并保存到 SQLite `overview_snapshot` 单行中。页面展示快照生成时间。首次无快照时由后台 alarm 尽快生成，接口返回 503 提示稍后刷新；生成失败保留上次成功快照，DO 重启后继续读取。数量包含停用项；来源沿用目录规则，包含默认「网站」，标签包含旧分类对应的标签。快照不保存或回传脚本正文、Cookie 值和 Token 明细。设备管理继续通过 `/admin/api/management-overview` 读取实时数据；Token 页通过 `/admin/api/access-tokens?limit=20&offset=0` 读取当前页与总数，定时刷新保留当前页。

调用计数存于 SQLite `discovery_source_calls`，从部署此功能后累计，DO 重启保留。通过鉴权、匹配到脚本的真实 RSS/Atom 请求按已登记且启用的源计数，包含缓存命中及后续失败；调试、管理预览、测试和后台刷新不计入。源身份沿用路由 pathname（忽略 host 和 RSS/Atom 前缀）加归一化 query，不包含 token；同一身份登记多个地址时，每个源都加一次，总次数为当前源计数之和。改名、编辑及停用保留计数，删除源同时删除计数。外部 RSS 源和未到达 Worker 的客户端/CDN 缓存请求无法统计。

“Cookie 管理”进入 `/cookies`，按域名分组显示已提交的 Cookie 键值列表，值可逐条编辑保存，也可在组内添加键值对、删除已有条目。`GET /admin/api/cookies` 读取，`POST|PATCH|DELETE /admin/api/cookies` 按域名 + key + 路径只增改删目标 Cookie，修改值保留路径、过期时间等属性。同名但不同路径的 Cookie 分别显示；新增键值对默认路径 `/`。「导入 Cookies」弹窗支持填写域名并粘贴 `key=value; k2=v2`；默认使用当前域名，也可填写新域名，按 `/` 路径新增或更新同名条目，值中的等号保留。导入中断时保留已保存结果和剩余输入，可继续重试。操作复用推送校验和缓存失效流程，失败保留草稿；重新读取前确认放弃未保存的修改。接口由 Cloudflare API Worker 提供，全量推送仍使用 `POST /admin/api/cookies/update` 或 `POST /api/cookies/update`。

Cookie 全量推送请求统一使用 `data` 字符串，替代请求顶层的 `cookies`、`cookie_data` 和 `encrypted`。`crypto_type` 省略或为 `none` 时，对 `data` 执行 `JSON.parse`；解析内容支持 Cookie 数组、域名到 Cookie 数组的分组对象，以及原有的 `{ cookies: [...] }` / `{ cookie_data: {...} }` 内部结构。例如：

```json
{"crypto_type":"none","data":"[{\"name\":\"sid\",\"value\":\"example\",\"domain\":\".example.com\"}]"}
```

加密推送前，在后台「设置」→「Cookie 解密」填写与推送端相同的 UUID 和原始密码。`GET|PUT /admin/api/settings/cookies` 读取和保存配置，需要管理员身份；读取仅返回 UUID、是否已配置和更新时间。密码留空保留已有密钥；首次配置或更换 UUID 时必须填写密码。服务端计算 `MD5(uuid + "-" + password)` 小写十六进制摘要的前 16 个字符作为解密密钥，用 `ADMIN_PASSWORD` 派生的 AES-GCM 密钥加密保存，不保存或回显原始密码；更换 `ADMIN_PASSWORD` 后需要重新填写 Cookie 解密密码。已有环境变量凭据仅在无后台配置时自动导入一次，后续修改以后台为准。

加密推送使用 `{"uuid":"已配置的 UUID","crypto_type":"aes-128-cbc-fixed","data":"Base64 密文"}`，校验后台保存的 UUID 后解密，再解析 JSON 并存储。两种加密模式共用这组凭据。支持的 `crypto_type`：

- `aes-128-cbc-fixed`：AES-128-CBC，直接使用上述派生密钥的 16 字节 UTF-8 表示，IV 为全零的 16 字节。
- `aes-256-cbc`（也接受 CookieCloud 的 `legacy`）：AES-256-CBC 兼容模式，`data` 是 OpenSSL/CryptoJS 格式的 Base64 字符串，解码后为 `Salted__` + 8 字节 salt + 密文。按 [CookieCloud 官方示例](https://github.com/easychen/CookieCloud/blob/master/examples/decrypt.py)使用 EVP_BytesToKey（MD5，1 次迭代）派生 32 字节密钥和 16 字节 IV。

其他加密方式、无效密文、无效 JSON 或无效 Cookie 数据返回 400，保留已有存储。合法推送会全量替换 Cookie；`data` 为 `"[]"` 时清空存储。

## MCP 授权

客户端连接同域名 `/mcp`，由 `401 WWW-Authenticate` 中的 `resource_metadata` 发现授权服务器。提供 `GET /.well-known/oauth-protected-resource`（同时支持 `/mcp` 后缀）及 `GET /.well-known/oauth-authorization-server`，按 [MCP 授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) 使用 OAuth Authorization Code + PKCE S256。

1. `POST /oauth/register` 注册公开客户端，提交 JSON `client_name`、`redirect_uris` 和 `token_endpoint_auth_method: "none"`，返回 `client_id`。回调必须是 HTTPS 或本地 HTTP 回环地址，不支持通配符、URL 凭据或 fragment。
2. 客户端生成 `state`、PKCE verifier 与 S256 challenge，打开 `GET /oauth/authorize`，携带 `client_id`、`redirect_uri`、`response_type=code`、`code_challenge`、`code_challenge_method=S256`、`resource=<同域名 /mcp 完整地址>` 和可选的 `scope`、`state`。
3. 服务校验注册信息后转到 独立授权页 `/admin/oauth?request=...`（顶部展示 FindRSS Logo 与当前版本，不加载后台导航或授权列表），使用现有后台登录。确认页展示申请方、客户端 ID、回调地址及申请的权限，允许缩减权限。默认 `discovery:create` 对应 `add_subscription`；`scripts:create` 对应 `add_script`，允许编译并发布脚本。只有明确点击同意后才产生授权码；拒绝返回 `access_denied`。
4. 网页导航到已注册回调，携带一次性 `code`（有效期 60 秒）、原始 `state` 和 `iss`，不携带 Token 或管理员密码。客户端向 `POST /oauth/token` 提交表单 `grant_type=authorization_code`、`client_id`、`redirect_uri`、`code`、`code_verifier`、`resource`，得到 `access_token`、`refresh_token`、`expires_in`、`token_type`、`scope`，由客户端保存到自己的凭据存储中。FindRSS 不负责写入客户端配置。
5. 访问凭据有效期 1 小时；使用 `grant_type=refresh_token`、`client_id`、`refresh_token`、`resource` 换取新凭据。刷新时轮换访问与刷新凭据，重放旧刷新凭据会撤销整个授权。授权总有效期 90 天；到期或撤销后必须重新授权。`POST /oauth/revoke` 接受表单 `client_id`、`token`，可撤销所属授权。

授权请求 10 分钟内有效。客户端名为申请方自报信息，确认时应同时核对回调地址。授权码绑定客户端、精确回调地址、资源与 PKCE；并发换证只能成功一次。服务器仅保存授权码与凭据摘要，OAuth 凭据、注册信息、权限和撤销状态存储于 Durable Object SQLite 中，Worker 重启后仍生效。公开注册支持最多 2000 个客户端，待完成的授权请求最多 1000 个（新请求时清理过期记录），有效授权最多 100 个。

「设置 → MCP 授权」展示已有授权（优先有效记录，最多 200 条，每页 20 条）、权限、到期和最近使用时间。撤销需确认，立即阻止后续访问和刷新。管理接口均需现有管理员认证：`GET /admin/api/mcp-tokens` 读取列表；`POST /admin/api/mcp-tokens/:id/revoke` 撤销；`GET /admin/api/mcp-tokens/:id/calls` 返回最近 50 条调用结果；`GET /admin/api/mcp-oauth/requests/:id` 读取待确认申请；`POST /admin/api/mcp-oauth/requests/:id/decision` 提交 JSON `approved` 与用户选择的 `scopes`。不再支持 `POST /admin/api/mcp-tokens` 手动签发。

`add_subscription` 添加前会读取目标 RSS/Atom 的真实名称、简介、站点及头像，头像下载后保存至订阅源头像存储；不需要用账号 ID 拼接占位名称。`title` 和 `description` 参数仅为可选提示，保存时以源返回的信息为准。读取失败、头像下载失败或名称为空时不会创建订阅；头像存储阶段失败会明确返回已创建的源及错误。来源地址仍按 `{{hostname}}/rss/...` 模板保存。源读取完成后再次验证授权，读取期间被撤销的授权不能创建订阅。

每次 MCP 请求及工具派发前重新检查授权状态和权限，`tools/list` 仅返回获准工具；越权返回 HTTP 403，无效、到期或撤销返回 HTTP 401。授权绑定当前请求域名，Worker 覆盖外部传入的资源头。审计全局保留最近 1000 条工具名、结果与时间，不保存凭据或工具参数。撤销不会回滚已经执行的调用。旧独立 MCP Token 可继续使用至到期或撤销；`ADMIN_PASSWORD`、Basic、读者和设备凭证均不能调用 `/mcp`，更改管理密码不影响已签发的 MCP 授权。

## 构建与检查

“存储”页面位于 `/admin/storage`，以文件树浏览 `API_STORAGE` 桶。进入页面或刷新时只读取根目录第一页，子目录默认折叠，展开时才读取其直接子级，每次最多 100 项；后续分页通过点击「加载更多」读取，不递归遍历目录或自动读完全部分页。已加载目录在折叠后保留缓存，读取失败可点击重试，刷新或卸载页面会取消未完成的目录请求。使用 Timeless `ListViewV2` 只渲染视口及缓冲行，支持方向键与 Enter，也可手动折叠目录。选择文件后在右侧预览图片或文本；`.json`、`.xml`、`.js` 后缀（不区分大小写）优先按文件名识别，在只读 CodeMirror 中格式化、高亮，允许选择复制，JSON 大整数保留原值，无效 JSON 保留原文。其他文本沿用纯文本展示；文本预览限制为解压后前 1 MiB，截断内容保留原文，其余二进制类型显示不支持预览。仅提供预览和刷新，不提供下载、上传、删除、重命名或拖拽移动。所有入口均需管理员登录。

已用空间按 R2 对象大小求和，最多扫描 50 页；达到上限时显示 `≥` 和用量下限提示。展开目录或加载更多不会重新扫描用量，点击刷新才重新统计。

在项目根目录执行 `npm run dev`、`npm run build`、`npm test` 或 `npm run deploy`。

后台测试集中在 `admin/__tests__/`，由项目根目录的 `npm test` 统一运行。原子样式检查递归覆盖本目录下的页面、组件与图标；主题变量和编辑器依赖 CSS 单独构建。组件通过 `atomic_classes` 合并默认原子类与调用方覆盖，同一属性保留最后一个类。

脚本管理页面使用 `pages/script.js`、`pages/script.model.js` 和 `pages/script.default.js`，统一承载 RSS、热榜等脚本类型；页面地址为 `/admin/scripts`。

脚本卡片不提供启用 Switch；点击“执行日志”在独立弹窗中查看当前脚本的日志和更早记录，支持关闭按钮、遮罩及 Escape 关闭。后台删除操作统一使用共享 `Popconfirm` 二次确认，包括单项及批量删除；取消不发出删除请求，确认提交期间阻止重复操作。

已发布脚本的「保存草稿」单独保存工作副本，正式源码、路由、版本和 Cookie 授权继续生效；关闭后再次编辑会恢复已保存草稿，Diff 仍以正式源码为基准。「发布正式」通过校验后才替换线上版本并清除工作副本。列表中的「退回草稿」统一通过 `Popconfirm` 二次确认后主动下线，会停止正式路由，并用当前正式版本作为草稿；若已有独立草稿，确认内容同时提示覆盖及丢失未发布修改的风险，取消则保留正式版本和原草稿。「撤销 Cookie 授权」也通过 `Popconfirm` 确认后执行。

页头的“安装脚本”支持输入公网 HTTP(S) 源码直链或粘贴完整脚本。点击“保存并预览”后，服务端下载并在现有沙箱中解析，展示名称、类型、来源、维护者、路由与访问范围、Cookie 权限、配置声明和源码；此时不保存，也不执行 handler。确认后可保存草稿，或填写版本号后发布安装；发布沿用现有 Cookie 授权确认。修改输入后需重新解析。下载逐跳检查地址，最多 5 次重定向、15 秒超时，源码上限为 10MB（10 × 1024 × 1024 字节），预览、保存和调试使用同一上限。

脚本可通过 `export const version = "1.0.0"` 声明版本号，使用三段数字格式。安装预览成功后自动填入版本输入框，管理员可手动修改；未声明时保持空白，更换安装输入后清空旧版本。最终保存和发布使用输入框中的版本号。

安装时确认的 Cookie 权限适用于该脚本版本的源码、Cookie 权限声明和脚本路由。新增公开订阅源，以及调整订阅源的公开性、启停或删除，不影响脚本授权。旧授权记录中的公开源列表也会忽略，升级后无需因此重新确认。复用订阅源预览结果时仍检查脚本授权，已撤销的权限不能用于生成或发布快照。

绑定 `API_STORAGE` 后，正式源码和草稿保存在 R2，列表只加载元数据，打开编辑器时再读取源码。点击脚本卡片右上角的版本号按钮打开「版本历史」，查看历史源码或回退正式版，回退保留未发布草稿，校验旧版配置、路由及 Cookie 权限，并刷新关联订阅源快照。下一次发布的版本号仍须高于历史最高发布版本。旧 SQLite 脚本启动后分批迁入 R2；历史记录从迁移时仍保留的版本开始。

Debug 以路由作为一级 Tab，每条路由独立保留调试地址、输出、上下文和日志，切换时取消尚未完成的请求。二级 Tab 根据 handler 实际返回值的 `kind` 更新：`rss` 提供「XML 预览 / 预览」，`img`、`video`、`audio` 提供「预览」，分别渲染图片、MP4 视频和音频播放器；各类型均保留「输出 / 上下文 / 日志」。修改源码会把各条路由的旧结果标记为待重新调试。新增和编辑脚本时实时调试默认关闭，页面不提供实时调试开关；修改代码或调试地址后，点击「运行」手动调试当前路由。仅填写或修改版本号保留已有调试结果，取消等待中及进行中的调试，不自动调试或弹出 Cookie 授权；点击「发布正式」时检查新版本授权并按需确认。主动运行调试仍按当前版本检查 Cookie 授权。

Debug 的卡片预览支持同一草稿内尚未发布的图片代理路由（需声明 `allowed_hosts`）。成功调试后，图标和封面通过管理员专用的短期预览入口读取，使用本次 Debug 的源码和 Cookie 授权；XML 与原始输出保留正式地址。预览不会发布脚本或写入公开图片缓存。草稿快照在 R2 私有预览目录中最多保留 16 份、有效期 15 分钟，可由不同 Worker 请求读取；过期或被淘汰后重新运行 Debug 即可。

媒体 handler 返回 `{ kind: "img" | "video" | "audio", url: "https://…", headers?: { Referer: "https://…" } }`，也可用 `Result.Ok(...)` 包装。公开直链可省略 `allowed_hosts`，浏览器直接读取；需要代理或自定义请求头时，在路由声明 `allowed_hosts`，Debug 使用受管理员会话保护的本次返回值快照，视频和音频支持 Range、HEAD 和流式读取。媒体返回值的 `kind` 与模块级 `export const kind = "rss" | "hot"` 的脚本分类不同。

“设置”使用 `pages/settings.js` 作为 layout，通过 `KeepAliveSubViews` 承载七个子路由：设备 Token（`/admin/settings/device-tokens`）、MCP 授权（`/admin/settings/mcp-tokens`）、Cookie 解密（`/admin/settings/cookies`）、Webhook 消息推送（`/admin/settings/webhook`）、订阅源抓取（`/admin/settings/snapshots`）、大模型（`/admin/settings/models`）和关于（`/admin/settings/about`）。关于页展示项目 Logo、描述、GitHub 仓库链接和当前版本号 `v1.4.0`。`/admin/settings` 与 `/admin/settings/` 默认进入设备 Token；各子页面位于 `pages/settings/`，只在激活时加载对应配置，支持直接访问和前进后退。大模型页可配置厂商、API Key、模型与参数，并测试连接、保存或恢复默认。设置页和 XiaoxunAgent 的“大模型设置”共用 `pages/settings.ai.component.js` 编辑器与 `components/ai_settings.js` 状态逻辑，读写同一个 `/admin/api/scripts/agent/settings` 接口，连接测试使用 `/admin/api/scripts/agent/test`。读取失败时提供重试，加载完成前不显示编辑表单；离开对应子页面时丢弃未保存草稿和临时密钥，返回时重新读取最新配置。

“设置 → 订阅源抓取”可配置默认抓取规则及最大并发抓取数（1 至 16，默认 4），通过 `/admin/api/settings/snapshots` 保存并持久化。并发数保存后用于订阅源自动抓取；调低时不终止已开始的任务，只修改并发数不会推迟已有抓取计划。

`/admin/*` 先交给 Worker 处理；GET / HEAD 页面路径在静态资源不存在时回退 `/admin/index.html`，由前端路由决定页面。API、认证路径、静态文件与写请求不走页面回退。SPA 入口使用 `/admin/` 下的绝对资源地址，直接访问嵌套路由或带尾斜杠的路径也能正确加载脚本和样式。

厂商仅支持 OpenAI 兼容接口，已移除 Workers AI 绑定模式；旧配置中的 Workers AI 不再显示或参与对话选择。厂商 SVG logo 从 `findrss/xiaoxunrss/public/provider-logos/` 同步到本项目，彩色图标使用 `Img`，单色图标使用随主题变色的 CSS 遮罩。

创建脚本时可把 RSSHub 的 GitHub 源码链接交给 XiaoxunAgent，例如 `https://github.com/DIYgod/RSSHub/blob/master/lib/routes/005/index.tsx`，并要求转换。助手通过 `fetch_rsshub_route_js` 读取真实源码，按需继续读取依赖，分析参数、列表、详情与时间逻辑，再转换为 FindRSS QuickJS 支持的 JavaScript，编译校验后更新当前草稿。填写实际调试链接后可继续运行 Debug；保存与发布由管理员操作。抓取仅支持 `DIYgod/RSSHub` 仓库 `lib/` 下的 JS/TS/TSX/JSON 源码，单文件最多 64KB，返回依赖候选链接，不执行上游源码。

登录页使用 Timeless `Form` 和 `Img` 原语，通过 `onSubmit` 提交，不使用 `View({ as })`。内置 0.34.2 核心与 DOM 运行时同步自本地 Timeless 构建。脚本编辑已移除 Mock 上下文、模板、抽屉与模拟测试，只保留真实请求调试。
