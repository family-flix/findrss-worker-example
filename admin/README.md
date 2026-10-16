# FindRSS 管理后台模块

本目录是纯前端模块，由 `findrss-worker/index.js` 所在的主 Worker 提供页面与接口。统一安装、启动与部署见 [Worker README](../README.md)。


完整的部署、初始配置和后台使用说明见[安装与配置指南](../docs/setup.md)。

本目录保存管理后台模块，所有页面位于同一个 Worker 的 `/admin/`。

业务源码按 `pages/`、`components/` 拆分；每个页面使用 `pages/xx.js`（View）与 `pages/xx.model.js`（Model）配对，模型维护状态、请求、校验和业务行为，视图只渲染并调用模型方法。`store.js` 集中声明路由、生成导航菜单并实现认证初始化、会话检查、登录、退出和鉴权请求，`app.js` 是浏览器入口，测试在 `__tests__/`。根构建从 `public/` 复制公共资源，生产构建由 `scripts/build_admin_ui.js` 打包后台文件，开发模式由 `scripts/admin_dev.js` 准备 ES modules，两者直接写入同一个临时资源目录；不再单独复制或构建 `admin/dist/`。两站共享品牌与 manifest 基础配置。后台 `style.css` 只声明单属性原子类；具体尺寸在页面的 `style` 中维护，响应式原子类通过显式传入的 CSS 变量调整同一个属性。组件与页面统一使用原子类；焦点、禁用和 ARIA 状态使用单节点原子变体，禁止业务类和父子选择器。共用组件的内部布局通过 `bodyProps`、`headerProps`、`listProps` 等参数传入；CodeMirror 通过 `wrapperStyle` 设置尺寸。

管理界面直接复用 `components/frui/` 的按钮、表单控件、Card 和 PageHeader，组件源码、主题 token 和 SVG 图标注册表全部保存在本目录；`style.css` 保存单属性原子类，`components/frui/tokens.css` 提供主题变量，输出为 `frui.css`。`admin/components/ui.js` 只接入宿主和兼容后台的事件形状，不引入阅读器账号或业务状态。`npm run dev` 启动时仅预打包 npm 依赖，通过 import map 和原生 ES modules 加载后台源码；开发入口确保共享 UI 就绪后加载页面，源码保存后原样同步到静态资源目录，刷新页面即可生效。开发资源禁用缓存，import map 仅通过开发专用 CSP 哈希放行；监听会随开发服务退出而关闭。`npm run build` / 部署仍由 `scripts/build_admin_ui.js` 使用 esbuild 打包源码。两种模式共用 `public/assets/timeless/0.34.2/` 的 Timeless Core/DOM，依赖由统一项目安装，产物不依赖运行时访问阅读器站点。

## 请求结构

HTML 先通过 script 标签加载 Timeless 全局运行时。`components/ui.js` 首先导入 `store.js`，将 `vm`、`kit`、`ui` 命名空间挂到全局，再导入 `components/icons/index.js` 注册本地图标，组件直接使用 `vm.DialogCore`、`kit.RequestCore` 等。

```text
Browser
  ├── /admin/login.html ── 登录表单
  ├── /admin/index.html, /admin/app.js, /admin/style.css ── Worker ASSETS
  ├── /admin/auth/* ── 管理 HTTP 边界 登录与会话接口
  └── /admin/api/* ── 主 Worker 管理路由 ── 直接调用 API 处理函数
```

主 Worker 的 `admin.js` 提供后台登录、会话和页面路由；本目录没有 Worker 入口。登录表单只需输入密码，请求只提交 `password`；后端固定使用用户名 `admin`，密码来自 Worker secret `ADMIN_PASSWORD`；验证成功后签发 12 小时有效、`HttpOnly`、`SameSite=Strict` 的签名 Session Cookie。各管理页在 `beforeReady` 阶段检查当前路由是否需要登录，未登录时通过 `location.replace` 进入登录页；会话失效或主动退出也会回到登录页。代理管理 API 时，管理 HTTP 边界 在服务端注入管理员 Bearer Token，不向浏览器暴露 Secret。

管理后台页面统一由 `components/shell.js` 承载：桌面端使用固定侧边栏，移动端切换为底部导航；各业务页面共用这套外壳、页头和组件样式。新增子页面时，先建立 `xx.js` 与 `xx.model.js`，再在 `store.js` 的 `routes_configure.admin.children` 中声明路径、页面、标题和图标，并让页面根 View 调用 `FindRSSAdminShell.Page({ page_id, title, description }, children)`，业务 View 作为 `children` 传入，并导出页面函数供路由绑定；页面不再通过 `window.FindRSSAdminPages` 注册或自行挂载。

“网络测试”进入 `/admin/network`，通过管理员接口 `POST /admin/api/network-test` 直接从当前 Worker 发起 GET 请求。支持编辑网址、请求头键值行和 1–60 秒超时（默认 10 秒）。请求头可添加、删除，名称和值均可编辑；完全空白行忽略，空值保留，无效名称、重复名称（忽略大小写）和含换行或空字符的值禁止提交。修改有效 HTTP(S) 网址后自动填入 Referer（移除 URL 片段，已删除时补回），仍可手动覆盖。测试结果展示逐跳重定向状态、每跳响应头耗时、总耗时和响应头。文本正文最多读取 64KB，在只读 CodeMirror 中按响应 Content-Type 格式化、高亮 HTML、JSON（包括 `+json`）、JS、CSS，其他文本不高亮；无效或截断的 JSON 保留原文，JSON 大整数不会被重写。图片、视频、音频改用媒体预览，读取同次请求返回的完整字节（最多 16MB），通过 multipart 将诊断 JSON 和媒体文件一并返回，再由浏览器 Blob URL 展示，切换请求或离开页面时释放；播放器不另行请求原网址。超过媒体上限、其他二进制类型或 `Content-Disposition: attachment` 响应只展示文件名、类型、大小，大小取自 Content-Length，未提供时显示未知；支持 UTF-8 `filename*`。默认填入起点目录示例及相同请求头，便于复现脚本超时。Cookie 区域按目标网址的域名筛选后台已保存的匹配域名（包含父域），默认勾选，支持手动取消；同域名下修改路径或刷新保留选择，切换域名重新默认勾选，提供刷新、读取失败重试及无 Cookie / 无匹配空态。最终响应及逐跳请求的状态码使用标签：2xx 绿色、3xx 黄色、4xx/5xx 与无响应红色，1xx 蓝色。`GET /admin/api/network-test/cookie-domains` 仅返回域名与数量，测试请求只提交 `cookie_domains`，Cookie 值由服务端读取；不接受手工 Cookie 请求头。离开页面清空勾选，返回时重新读取域名。目标及重定向均复用公网地址校验，仅允许 HTTP(S) 的 80 / 443 端口，最多跟随 5 次重定向；未勾选时匿名访问；每一跳根据所选域名、目标域、路径、hostOnly、Secure 和有效期重新匹配 Cookie，不会转发其他站点的 Cookie；跨域移除手动填写的认证头。部署后测量线上 Worker 出口，本地运行则测量本地出口。“开始测试”旁提供“复制 curl 命令”：通过管理员接口 `POST /admin/api/network-test/curl` 复用相同参数校验和 Cookie 匹配，生成当前 URL 的 GET 命令，包含实际请求头、匹配的已选 Cookie、超时及响应头输出，生成命令不请求目标网站，也不包含后台登录凭证。命令可粘贴到本机 POSIX shell 比较出口，保留已有测试结果；仅复现首个请求，不自动跟随重定向。命令可能包含站点登录凭证，勿公开分享。

每张设备卡片通过“日志”按钮打开右侧抽屉，并调用 `/admin/api/devices/:device_id/logs` 查看最近 7 天的设备行为。连接、心跳、调用、响应和系统事件均以结构化日志保存；抽屉支持分类、自动刷新、向前分页和详情展开。敏感字段落库前会脱敏，超大详情会截断。

“消息”进入 `/admin/messages`，汇总所有脚本的错误，包括订阅请求、测试运行与保存校验。错误复用 `script_logs` 持久化并保留 7 天，`/admin/api/messages` 按 `before_id` 分页；`/admin/api/messages/ws` 实时通知后台加载新消息，断线自动重连并补拉记录。消息显示脚本名称、路由、源码行列、错误堆栈、实际传入的 params/query 与日志；敏感参数脱敏。旧日志的包装行号标为“沙箱行号”，没有位置的错误不猜测行号。默认打开“未读” Tab，标记已读后消息从未读列表移至“已读” Tab，两边分别显示空态与历史分页。未读徽标与“全部标记已读”使用当前浏览器的本地已读位置。Cloudflare Worker 和 Go API 均支持消息接口。

订阅源列表的“强制刷新快照”立即重新生成完整 RSS/Atom XML，并更新快照状态，也适用于仅手动模式。公开源同时更新广场的三篇文章预览；私密源只更新订阅 XML，不发布文章预览。外部订阅地址的 XML 由上游管理。

「设置 → 快照抓取」配置默认规则，默认每 1 小时；每个源的新增/编辑表单可覆盖默认。支持按间隔、智能刷新、每天指定时间、多个时间点、分时段、五段 Cron 和仅手动。定时规则可设置时区、星期；分时段每行填写 `星期 开始时间-结束时间 间隔分钟`，例如 `1,2,3,4,5 08:00-18:00 10`，支持跨午夜，时段外间隔为 0 时停止抓取。间隔为 5 至 1440 分钟。列表显示规则与下次自动抓取时间；规则随 JSON 导入导出保留。自动规则适用于启用的公开源和私密自有源。私密源只保存 XML 和抓取状态，不发布文章预览，订阅读取仍需有效凭证；选择仅手动可停止自动抓取。外部私密源的快照由上游管理。

侧边栏的“订阅源”进入 `/admin/discovery` 子页面。该页面调用 `/admin/api/discovery/sources` 新增、编辑、启停、排序和删除 RSS/Atom 订阅源；启用中的订阅源会出现在 Discovery 页面默认列表，并优先参与搜索结果。表单里的「需要 token 访问」复选框始终显示，不随地址形态隐藏；自有脚本源可填 `{{hostname}}/rss/<路由>` 或 `{{hostname}}/atom/<路由>`，登记校验与公开性匹配都不区分这两个前缀。列表里的 `{{hostname}}` 模板地址由 API 按本环境 `FINDRSS_HOSTNAME` 展开后返回（可直接打开），编辑时则回填存储原文，不会把模板固化成本环境地址。

列表页的「导入 JSON」弹窗可粘贴 JSON 或通过 FilePicker 拖拽、选择 `.json` 文件（最大 2 MB）。支持当前「导出 JSON」的 `{ "sources": [...] }` 格式及订阅源数组，每项至少含 `title`、`feed_url`；保留模板地址与源配置，仅新增并跳过已有及批内重复地址，不导入 ID、头像或快照。逐项复用新增接口校验与保存，失败保留已保存结果及剩余 JSON，可继续重试。


“Token”子页面（`/admin/tokens`）调用 `/admin/api/access-tokens`，创建、立即过期和移除用户凭证。Token 可以留空自动生成，也可以手动指定；用途或使用人可选填，还可成对填写 email + password 作为 Reader 的第二种登录方式。用户 Token 明文只在创建响应中出现一次并仅保存 SHA-256 摘要；密码使用随机盐和 PBKDF2-SHA-256 保存。

“设置 → Device Token”和“设备管理 → Device Token”共用管理界面，通过 `/admin/api/device-tokens` 管理多个设备接入凭证，支持名称、备注、有效期、最近使用时间和撤销。创建成功后自动获取明文并在弹窗展示，支持复制；关闭弹窗或离开设置页清除弹窗明文。列表默认脱敏，管理员点击「查看明文」时才通过独立的 `POST /admin/api/device-tokens/:id/reveal` 接口获取解密结果，30 秒自动隐藏；撤销删除密文并断开关联连接。旧 `DEVICE_TOKEN` 自动导入，部署时不再必填。设备 Token 与用户 Token 分开保存；设备 Token 的加密副本依赖部署的 `ADMIN_PASSWORD`，轮换后台密码后应创建新设备 Token 替换原凭证。

`/admin/overview` 每 5 秒读取 `/admin/api/overview` 的 `statistics` 快照：脚本、订阅源、Cookie 数量，去重后的有效路由声明、平台和标签数量，以及每个订阅源的累计调用次数与总次数。数量包含停用项；平台沿用目录规则，包含默认「网站」，标签包含旧分类对应的标签。快照只读元数据，不回传脚本正文或 Cookie 值。

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

## 构建与检查

在项目根目录执行 `npm run dev`、`npm run build`、`npm test` 或 `npm run deploy`。

后台测试集中在 `admin/__tests__/`，由项目根目录的 `npm test` 统一运行。原子样式检查递归覆盖本目录下的页面、组件与图标；主题变量和编辑器依赖 CSS 单独构建。组件通过 `atomic_classes` 合并默认原子类与调用方覆盖，同一属性保留最后一个类。

脚本管理页面使用 `pages/script.js`、`pages/script.model.js` 和 `pages/script.default.js`，统一承载 RSS、热榜等脚本类型；页面地址为 `/admin/scripts`。

Debug 以路由作为一级 Tab，每条路由独立保留调试地址、输出、上下文和日志，切换时取消尚未完成的请求。二级 Tab 根据 handler 实际返回值的 `kind` 更新：`rss` 提供「XML 预览 / 预览」，`img`、`video`、`audio` 提供「预览」，分别渲染图片、MP4 视频和音频播放器；各类型均保留「输出 / 上下文 / 日志」。修改源码或版本会把各条路由的旧结果标记为待重新调试，实时调试跟随当前选中的路由。

Debug 的卡片预览支持同一草稿内尚未发布的图片代理路由（需声明 `allowed_hosts`）。成功调试后，图标和封面通过管理员专用的短期预览入口读取，使用本次 Debug 的源码和 Cookie 授权；XML 与原始输出保留正式地址。预览不会发布脚本或写入公开图片缓存。草稿快照在当前 DO 内最多保留 16 份、有效期 15 分钟；过期、被淘汰或服务重启后，重新运行 Debug 即可。

媒体 handler 返回 `{ kind: "img" | "video" | "audio", url: "https://…", headers?: { Referer: "https://…" } }`，也可用 `Result.Ok(...)` 包装。公开直链可省略 `allowed_hosts`，浏览器直接读取；需要代理或自定义请求头时，在路由声明 `allowed_hosts`，Debug 使用受管理员会话保护的本次返回值快照，视频和音频支持 Range、HEAD 和流式读取。媒体返回值的 `kind` 与模块级 `export const kind = "rss" | "hot"` 的脚本分类不同。

“设置”进入 `/admin/settings`，可配置大模型厂商、API Key、模型与参数，并测试连接、保存或恢复默认。设置页和 XiaoxunAgent 的“大模型设置”共用 `pages/settings.ai.component.js` 编辑器与 `components/ai_settings.js` 状态逻辑，读写同一个 `/admin/api/scripts/agent/settings` 接口，连接测试使用 `/admin/api/scripts/agent/test`。读取失败时提供重试，加载完成前不显示编辑表单；离开设置页丢弃未保存草稿和临时密钥，返回时重新读取最新配置。

`/admin/*` 先交给 Worker 处理；GET / HEAD 页面路径在静态资源不存在时回退 `/admin/index.html`，由前端路由决定页面。API、认证路径、静态文件与写请求不走页面回退。SPA 入口使用 `/admin/` 下的绝对资源地址，直接访问嵌套路由或带尾斜杠的路径也能正确加载脚本和样式。

厂商仅支持 OpenAI 兼容接口，已移除 Workers AI 绑定模式；旧配置中的 Workers AI 不再显示或参与对话选择。厂商 SVG logo 从 `findrss/xiaoxunrss/public/provider-logos/` 同步到本项目，彩色图标使用 `Img`，单色图标使用随主题变色的 CSS 遮罩。

创建脚本时可把 RSSHub 的 GitHub 源码链接交给 XiaoxunAgent，例如 `https://github.com/DIYgod/RSSHub/blob/master/lib/routes/005/index.tsx`，并要求转换。助手通过 `fetch_rsshub_route_js` 读取真实源码，按需继续读取依赖，分析参数、列表、详情与时间逻辑，再转换为 FindRSS QuickJS 支持的 JavaScript，编译校验后更新当前草稿。填写实际调试链接后可继续运行 Debug；保存与发布由管理员操作。抓取仅支持 `DIYgod/RSSHub` 仓库 `lib/` 下的 JS/TS/TSX/JSON 源码，单文件最多 64KB，返回依赖候选链接，不执行上游源码。

登录页使用 Timeless `Form` 和 `Img` 原语，通过 `onSubmit` 提交，不使用 `View({ as })`。内置 0.34.2 核心与 DOM 运行时同步自本地 Timeless 构建。脚本编辑已移除 Mock 上下文、模板、抽屉与模拟测试，只保留真实请求调试。
