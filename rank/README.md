# FindRSS 排行榜

直接访问 `/rank/`。独立的 `rank/` 前端复用 discover 的 Timeless 0.34.2 SSR 与 hydration 方式，响应 HTML 已包含榜单、封面地址、失败原因和内嵌 CSS；禁用 JavaScript 仍可阅读。紧凑网格在宽屏显示 4 列，随屏宽降为 3、2、1 列，缩小卡片间距与条目留白；有 `thumbnail` 时显示封面。

分类、来源使用与 discover 相同的单选标签形式，可与榜单搜索组合；筛选保留脚本排序，并同步到 URL 的 `category`、`source_type`、`q` 参数，分享地址或刷新后 SSR 选中状态一致。来源取 `platform.name`，分类优先取快照 `category`，再取模块导出值，缺失为「其他」。脚本可导出安全整数 `order`，按从小到大排列，省略按 `0`，同值保持原顺序；失败卡片也保留模块声明的分类、来源和顺序。参见 [Hot 脚本字段](https://github.com/ltaoo/findrss-scripts/blob/main/hot/README.md)。

默认读取独立仓库 [findrss-scripts/hot](https://github.com/ltaoo/findrss-scripts/tree/main/hot) 同步到主项目的全部 84 个内置脚本，以每个脚本主路由的 `example` 地址采集。若后台存在匹配该地址、已发布且启用的 Hot 脚本，优先通过脚本服务执行其当前正式源码、配置及 Cookie 授权；无匹配时匿名执行内置示例。小说及英语/日语平台脚本因此展示默认榜单；全部分类和周期仍可通过各脚本路由使用，见[小说榜单说明](https://github.com/ltaoo/findrss-scripts/blob/main/docs/usage.md#小说排行榜)和[英语与日语平台说明](https://github.com/ltaoo/findrss-scripts/blob/main/docs/usage.md#英语与日语平台)。本页不会自动发布示例，也不执行后台草稿或停用脚本。

YouTube 和 TikTok 需先在后台导入脚本，填写官方 API 配置并发布启用：YouTube 使用 `api_key`；TikTok 使用 `advertiser_id`、具有 Discovery 权限的 `access_token`。未配置时会展示明确的配置错误卡片，其他平台继续采集。新闻及精选内容源按上游顺序展示，不假定它们提供热度排名。

Worker Cron 每 5 分钟将 Hot 快照任务写入 D1 并投递 Queue，由现有任务服务异步采集并生成快照，最多同时处理 8 个脚本，每个执行传入 12 秒取消信号。编译、参数、权限、上游访问、解析和超时错误均保存在对应脚本的 JSON 快照中，其余榜单继续。没有显式排名时展示 `—`，不从列表位置推断排名。

每个脚本独立保存到现有 `API_STORAGE` R2 桶的 `rank/scripts/<脚本名>.json`，例如 `rank/scripts/qidian.json`。对象是未压缩的纯 JSON，类型为 `application/json; charset=utf-8`，包含 `id`、标题、分类、平台、排序、采集时间、错误原因和 `entries`（含封面、排名、热度）。脚本完成后立即写入自己的文件，不等待全部采集结束。某一份序列化或写入失败时保留该脚本的旧 JSON，其余脚本继续更新。同一实例合并重叠采集，后续定时任务始终重新采集，只复用编译结果。

各脚本 JSON 全部保存后，同一任务最多并发读取 8 份快照，校验通过后用共用 Model/View 生成完整 SSR HTML，gzip 压缩写入 R2 `rank/index.html`。页面包含排序后的榜单、分类/来源标签、封面、错误提示、内嵌样式和初始化数据。HTML 与版本标识、样式哈希一并原子发布；只有这一步完成后任务才结束。部分脚本采集失败时，其错误 JSON 仍参与页面生成；任一 JSON 保存/读取失败或 HTML 生成/写入失败时，任务记录失败并保留旧完整页面。

访问 `/rank/` 时只读取这一份预生成 HTML，默认页直接返回，不再逐个读取脚本 JSON 或执行脚本。带 `q`、`category`、`source_type` 时，仅根据页面内嵌快照渲染筛选首屏。每次请求读取当前页面版本，完整响应边缘缓存 60 秒，缓存键包含 HTML 版本、筛选条件、源码版本和样式哈希；后台发布新 HTML 后立即使用新缓存键，避免继续命中旧页面。浏览器搜索与筛选仍使用完整内嵌数据。

首次生成前、未绑定存储或 HTML 读取失败时，页面返回不缓存的 503 提示，访问不会补抓或启动后台任务。已有 HTML 在下一次完整发布前继续使用，独立 JSON 更新不会暴露半轮数据。旧 `rank/scripts/*.html` 不再读取；缺少页面版本标识的旧 `rank/index.html` 需要通过刷新任务重新生成。

本地不会自动模拟 Cron；完成前端构建后可用 `npx wrangler dev --test-scheduled` 启动，再用 `curl http://127.0.0.1:8787/__scheduled` 生成本地快照。生产定时配置在 `wrangler.jsonc` 的 `triggers.crons`。

管理员可通过 `POST /admin/api/hot/snapshot` 提交后台任务，依次完成全部内置 Hot 脚本 JSON 快照更新和 rank HTML 重建，无需请求体。接口支持后台登录会话、管理员 Bearer 或 Basic 凭证；带 `Origin` 时必须与请求地址同源。接口立即返回 HTTP 202 和 `{ task_id, task }`，不等待采集或 HTML 发布；手动触发与定时任务统一进入 API Durable Object 的任务服务，已有同类任务进行中时返回同一任务 ID：

```sh
curl -X POST 'https://findrss.example/admin/api/hot/snapshot' \
  -H "Authorization: Bearer $ADMIN_PASSWORD"
```

将示例域名替换为自己的站点，并在当前终端设置 `ADMIN_PASSWORD`。响应示例：

```json
{ "task_id": "任务 UUID", "task": { "id": "任务 UUID", "kind": "hot_snapshot", "title": "刷新热榜快照", "target": "/rank/", "status": "running" } }
```

在后台「任务」页 `/admin/tasks` 按卡片显示的任务 ID 对应接口结果，页面复用 `background-tasks.changed` 推送实时更新；也可通过已鉴权的 `GET /admin/api/background-tasks` 查询列表。状态包括 `running`、`completed`、`failed`、`cancelled`，记录开始/结束时间及错误原因。JSON 已写完但 HTML 尚在生成或上传时仍为进行中。脚本采集失败会在生成含错误提示的 HTML 后将任务标为失败；序列化、R2 写入或 HTML 发布异常也记录为失败。服务重启后，未结束任务会按现有规则标记为中断。

任务列表的「终止刷新」或 `POST /admin/api/background-tasks/<task_id>/cancel` 可取消任务，信号会传递给脚本执行并在 JSON、HTML 写入前检查，已经保存的快照保留。缺少鉴权返回 401，方法错误返回 405，跨站请求返回 403，服务或 R2 未配置返回 503；提交异常返回 500。HTTP 202 仅表示任务已开始，执行结果以任务状态为准，接口响应不缓存。

后台采集复用 `/api/hot` 的正式脚本执行流程，按脚本 ID、版本、源码哈希和声明权限验证 Cookie 授权，只向允许的上游地址发送指定 Cookie。授权无效时保存错误，不回退借用其他版本的权限；每轮强制重新采集，运行中撤销授权或切换版本会阻止旧结果返回。浏览器不接收 Cookie 值。抖音等需要 Cookie 的脚本需先在后台发布、启用并确认对应版本的授权，再触发 `POST /admin/api/hot/snapshot`，同一任务会替换旧错误 JSON 并重建 rank HTML；也可等待下一轮定时任务。上游风控仍可能导致失败。页面展示封面原始地址，未新增图片代理，站点防盗链或签名过期可能影响图片加载。

## 源码与构建

- `model.js`：业务状态、内容规范化、排序、搜索与分类/来源筛选。
- `view.js`：共用 SSR/浏览器视图。
- `index.js`：hydration 入口。
- `loader.js`：后台并发执行、失败隔离、重叠任务合并与编译缓存。
- `snapshot.js`：逐脚本独立写入 JSON、并发读取、数据校验与单份故障隔离。
- `home.js`：从已存 JSON 重建完整 HTML、发布页面版本与读取页面快照。
- `../server/service/worker/hot_snapshot.js`：手动触发接口的鉴权、方法校验和任务提交。
- `../server/service/application/hot_snapshots.js`：后台任务创建、运行合并和采集结果记录。
- `http.js`、`../rank.js`：Worker 页面与资源路由。
- `../server/infra/rank_home.js`：HTML、CSS 与初始数据装配。
- `scripts.js`：引用 `server/infra/builtin_script_sources.js` 中的内置 Hot 源码快照及内容版本。

`npm run build` 使用已提交的内置快照并构建 `/rank/index.js`、`/rank/style.css`，不依赖外部脚本目录，也不请求热榜网站；页面快照由后台 Cron 提前生成。在独立脚本仓库新增、修改或删除脚本后，在主项目运行 `node scripts/sync_hot_scripts.js /path/to/findrss-scripts`，提交生成的快照并重新构建部署，下一轮定时任务应用新脚本。追加 `--check` 可校验全部脚本是否已同步。`/rank` 系统命名空间已保留，采集脚本应使用自己的平台路径。

## 非浏览器检查

Node.js ≥ 22.19：

```sh
node --test rank/test/*.test.js
```

覆盖真实 QuickJS 执行全部示例（模拟网络回包）、并发上限、失败隔离、超时、参数、逐脚本保存 JSON、生成并发布 HTML、HTML 完成前保持任务运行、发布失败保留旧页面、页面版本切换与缓存隔离、管理员鉴权和异步提交、任务列表与取消、SSR 首屏、安全转义、组合筛选、排序、封面、HEAD 和总路由。构建及本地 dry-run 不会发布。完成后请手动验证 `/admin/tasks` 中的状态和取消操作，以及 `/rank/` 刷新后的内容、搜索、筛选和封面。
