export const SCRIPT_AGENT_RSSHUB_KNOWLEDGE = `
RSSHub 路由迁移到 FindRSS：
用户提供 RSSHub GitHub blob/raw 链接时，先调用 fetch_rsshub_route_js 获取真实源码，再分析并转换，不凭链接猜测实现。工具读取 DIYgod/RSSHub 的 lib/ 源码，支持 JS/TS/TSX/JSON；source 是待分析文本，绝不能直接执行。imports.candidate_urls 是依赖文件候选地址，不代表文件存在；有必要时用同一工具读取实际使用的相对依赖或 @/ 工具文件，404 时尝试下一个候选，不能猜测关键逻辑。namespace_url 可读取命名空间 metadata。工具失败时如实说明，不能声称已读源码或已完成转换。
先梳理路由参数、默认值、查询参数、请求地址/headers、列表选择器、详情页补全、时间及完整正文逻辑，再生成 FindRSS 支持的纯 JavaScript ES 模块。保留关键采集逻辑；不能悄悄删掉详情页、正文或参数支持。不能移植的功能须明确说明。
删除 TypeScript 类型、as 断言、JSX 和 RSSHub 专用配置；不能保留 cheerio、got、hono、dayjs、@/ 等外部 import。只能导入 @findrss/util。ctx.req.param() 改为 ctx.params，query 改为 ctx.query；got/axios/fetch 改为 utils.request_text/request_json 或 ctx.fetchText，并检查 Result.error，成功值从 data 读取。
Cheerio 的 load/find/text/attr 改为 utils.document_nodes/select/first/text_of/attribute。轻量节点没有 innerHTML、outerHTML、html() 或完整 DOM API。需要 HTML 正文时根据真实源码实现局部 HTML 序列化或可靠的原文片段提取，保留图片/链接/段落并正确处理转义；不能用纯文本冒充完整 HTML。JSX 模板改为带正确 HTML 转义的字符串。URL 相对地址用 utils.absolute_url，不能使用全局 URL。
RSSHub 返回的 item 改为 items；pubDate 改为 published；guid 或永久原文 link 转稳定 id；category 改为 categories 数组；content:{html,text} 改为 content HTML 字符串。RSSScript.run 只透传 SDK 约定的 feed 字段；需要 language、image、author 等顶层信息时在 run 返回的 Result 成功 data 上补充合法字段，或直接返回经过校验的 Result.Ok(feed)。使用 utils.timestamp 或 RSSScript.timestamp 正确处理原始时间与时区，不伪造时间，不重复偏移。RSSHub cache.tryGet 可去掉缓存包装并保留内部抓取逻辑，宿主自带 feed 缓存；限量参数需解析和约束，不能直接移植 getRouteLimit。
route.path 结合 lib/routes/<命名空间>/ 及 namespace 的实际定义补全前缀，例如 005/index.tsx 的 /:category? 转为 /005/:category?；保持参数默认值，并填写真实 example。RSSHub radar/features 不属于 FindRSS 路由字段。涉及 Puppeteer、设备、私密配置或认证时先说明依赖，遵循显式 Cookie 权限，不能硬编码凭据或虚构可用能力。
转换后先 get_script_draft 读取最新 revision，再 edit_script_draft 提交完整代码，由工具执行编译校验并同步编辑器；有工作区实际调试链接时调用 debug_script_draft 并修复错误。源码 GitHub 链接不是调试链接。缺失调试链接时完成草稿转换并说明尚未实站调试；不自行保存或发布。
`;
