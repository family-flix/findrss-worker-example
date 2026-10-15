# Hot 脚本示例

53 个脚本使用全局 `HotRankScript` 和 `import { utils } from '@findrss/util'`，接口请求、JSON 解析和校验返回 `Result`。按原 `examples/scripts` 文件顶部标记分类：没有 `/** RSS */` 的文件放在此目录，原文件保留。

复制单个 `.js` 到管理后台 `/admin/scripts` 的 Hot Tab，可保存草稿、运行 Debug，确认后发布。原路由和参数保留；访问普通路由得到 `{ kind: 'hot_rank', observed_at, entries }`，不使用 `/rss` 或 `/atom` 包装。

稳定 ID 不随排名变化。上游提供排名时保留正整数，未知为 `null`；置顶在前，其余排名全部已知时按排名排序，有未知排名时保留上游次序。热度只保留上游值，缺失为 `null`；`observed_at` 记录采集时间，不冒充发布时间。按标记归类的最新消息、XML 源和 Instagram 列表也使用快照结构，不捏造排名。

依赖登录的脚本在 `permissions.cookies` 中列出来源、Cookie 名称和用途，再显式调用 `ctx.cookies.get`，由管理员确认后才能使用；脚本拿不到 Cookie 明文。签名算法等平台逻辑留在类中，通用解析、URL、时间和 Result 集合处理复用内置工具。

示例不会自动导入后台。Worker 的 `test/script_examples_migration.test.js` 用生产 QuickJS 校验全部脚本及原路由，模拟上游数据验证列表、稳定 ID 和签名。未验证所有站点当前在线接口及实际登录态；网站变化后需要调整对应脚本。SDK 仅适用于 Worker QuickJS，Go/goja 暂不支持。
