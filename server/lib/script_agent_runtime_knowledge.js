// 两个后台助手共用脚本 SDK 知识；示例由真实 QuickJS 执行验证。
export const SCRIPT_AGENT_UTIL_EXAMPLE = `import { utils } from ${JSON.stringify("@findrss/util")};
class ExampleRSS extends RSSScript {
  async fetch(ctx) {
    try {
      const fetched = await utils.request_json(ctx, 'https://example.com/api/articles', {
        headers: { Referer: 'https://example.com/' },
      });
      if (fetched.error) return fetched;
      const list = utils.array_at(fetched.data, 'data.items');
      if (list.error) return list;
      const items = [];
      for (const row of list.data) {
        const id = utils.identity(row.id);
        if (id.error) return id;
        const link = utils.absolute_url(row.url, 'https://example.com/');
        if (link.error) return link;
        const published = utils.timestamp(row.published);
        if (published.error) return published;
        items.push({ id: id.data, title: utils.plain_text(row.title), link: link.data,
          published: published.data, content: row.content });
      }
      ctx.log('解析文章列表', { count: items.length });
      return Result.Ok({ title: '示例文章源', link: 'https://example.com/', items });
    } catch (error) { return Result.Err(error); }
  }
}
const script = new ExampleRSS();
export const route = { path: '/demo/utils', name: '工具模块示例', handler: ctx => script.run(ctx) };`;

export const SCRIPT_AGENT_HOT_RANK_EXAMPLE = `import { utils } from ${JSON.stringify("@findrss/util")};
class ExampleHotRank extends HotRankScript {
  async fetch(ctx) {
    const fetched = await utils.request_json(ctx, 'https://example.com/api/hot');
    if (fetched.error) return fetched;
    const entries = utils.array_at(fetched.data, 'entries');
    if (entries.error) return entries;
    return Result.Ok({ title: '示例热榜', link: 'https://example.com/', entries: entries.data });
  }
}
const script = new ExampleHotRank();
export const route = { path: '/demo/hot', name: '热榜示例', handler: ctx => script.run(ctx) };`;

export const SCRIPT_AGENT_COOKIE_EXAMPLE = `export const permissions = { cookies: [{
  id: 'account', origin: 'https://example.com', path_prefix: '/account/',
  names: ['session'], purpose: '读取用户授权的登录账户页面',
}] };
export const route = {
  path: '/demo/account', name: 'Cookie 授权示例',
  async handler(ctx) {
    const cookies = await ctx.cookies.get('account');
    if (cookies.error) return cookies;
    const fetched = await ctx.fetchText('https://example.com/account/profile', { cookies: cookies.data });
    if (fetched.error) return fetched;
    ctx.log('账户页面获取完成');
    return Result.Ok({ body: fetched.data, content_type: 'text/html; charset=utf-8' });
  },
};`;

export const SCRIPT_AGENT_RUNTIME_KNOWLEDGE = `
FindRSS Worker QuickJS 脚本 SDK 知识（编译、Mock 调试、真实 Debug 和正式执行共用）：

一、全局对象与 Result
全局已注入 RSSScript、HotRankScript、Result、BizError、parseJSON，不需要导入或复制定义。没有 console、DOM、Node.js 或原生 URL 对象。
Result.Ok(data) 返回 {data,error:null}；Result.Err(message,code?,data?) 返回 {data,code,error:BizError}，error 包含 message/messages/code/data。先检查 result.error，失败 return result，成功取 result.data；不能用 data 的真值判断成功（null/false/0 都可以是成功数据）。
ctx.fetchText、ctx.invoke、ctx.cookies.get 返回 Promise<Result>；ctx.fail(code,message) 返回失败 Result，必须 return 才会中止当前 handler。基类 fetch/run/timestamp 也使用 Result；脚本自己的请求、解析和校验异常应转成 Result.Err，不用 throw 作为正常失败流程。
parseJSON(text,reviver?) 返回 Result 并捕获语法和 reviver 错误。使用 parseJSON 或 utils.parseJSON，不直接 JSON.parse。纯字符串转换无需套 Result。
路由出口由宿主展开一层 Result，错误映射为 HTTP 响应；不要把 Result 当 feed、items 数组或 HTML 内容。ctx.invoke 是设备调用，真实 Debug 可能调用设备并扣积分，Mock 只使用声明的 invoke；不要虚构设备能力。

二、公共工具模块
脚本使用 ES 模块命名导入：\`import { utils } from ${JSON.stringify("@findrss/util")};\`。这是唯一可导入的内置模块，不是需安装的 npm 包；禁止宿主文件、其它包和网络模块。utils 是冻结的无状态对象，不提供 utils.source/main，通用工具优先复用，不重复声明。
decode_html/decode_entities(value) → string：解码常见 HTML 实体和数字实体，非法码点保留原文。plain_text(value) → string：剔除 script/style 和标签、解码实体。escape_html(value) → string：将纯文本嵌入 HTML 片段时转义；不是 HTML 安全清洗器，也不是 XML 转义。直接给 feed 的 title/description/content 时不用整体 escape_html，XML 由渲染端处理。
absolute_url(value,base) → Result<string>：拼接 HTTP(S) 地址，相对地址显式传 base；拒绝其它协议、用户凭据、非法字符，空值成功返回空串，必填链接仍须检查。
timestamp(value) → Result<number|undefined>：秒/毫秒/数字字符串/日期转毫秒；缺失为 undefined，无时区的年月日格式按北京时间。RSSScript.timestamp(value) 返回 Result<ISO字符串|undefined>，不能混淆两者的单位和返回类型。
identity(value) → Result<string>：稳定非空 ID，数字必须是安全整数；不要使用排名、列表下标、随机值或采集时间充当 ID。array_at(value,path='') → Result<Array>：按点分路径读取数组；空数组成功，缺失/类型错误失败。
request_text(ctx,url,options) / request_json(ctx,url,options) → Promise<Result>：复用 ctx.fetchText，后者再 parseJSON。默认提供基础 Accept、Accept-Language、User-Agent，headers 可覆盖；Referer、Cookie 句柄需显式提供，其它请求 options 透传。错误保留 Result，不猜测网站业务状态字段，脚本自行校验回包。
embedded_json(text,marker:RegExp) → Result：扫描 marker 后的 JSON 对象/数组，处理括号和字符串转义，不执行页面脚本。
document_nodes(text,xml=false) → Result<节点树>：轻量 HTML/XML 解析，XML 拒绝 DOCTYPE。rows(root,selector) → Result<非空节点数组>：必需列表缺失时失败。
descendants(root)/select(root,selector) → 节点数组，matches(node,selector) → boolean，first(root,selector) → 节点或 undefined，text_of(node)/field(root,selector)/attribute(root,selector,name) → 字符串；未命中 select 返回空数组，文本/属性返回空串。节点查询直接返回值，document_nodes/rows 返回 Result；元素有不可枚举的 parent 供父节点查询，节点树可 JSON 序列化。
feed_items(xml,base) → Result<Array>：解析常见 RSS/Atom 的 ID、标题、HTTP(S) 链接、正文、日期和缩略图，缺失日期不补齐；轻量解析不涵盖所有 XML 扩展。
map_results(array,mapper) → Result<Array> 和 replace_results(text,pattern,mapper) → Result<string>：同步回调必须返回 Result，保留成功 data，立即传播失败并捕获异常；不要把 Result 对象直接放入 Array.map 或 String.replace 的输出中。
选择器只支持标签、ID、class、属性存在/等于/前缀/后缀、后代和直接子节点；属性值不支持空白，不支持完整 DOM/CSS 或严格 XML 校验。parseJSON(text,reviver?) 同全局函数。

三、RSS 源与热榜
class WechatChannelsRSS extends RSSScript {} 实现 async fetch(ctx) 返回 Result<feed>，route.handler 返回实例 run(ctx)。RSSScript 校验标题、来源链接、items 的稳定 ID/标题/原文链接，归一化时间、按真实 published 倒序并按 ID 去重。无发布时间的条目在末尾，不用采集时间补齐；热度与置顶不参与 RSS 排序。基类透传条目 description/content/image/images/live_photos/media_group/type/author/enclosure/categories/extra，保留源 id/extra 和真实 updated；多图、视频和动态照片可经 run(ctx) 输出。
class BaiduHotRank extends HotRankScript {} 的 fetch(ctx) 返回 Result<{title,link,entries}>。entry 必须有稳定 id/title/link；非置顶 rank 是上游正整数或未知 null，置顶 pinned=true 且 rank=null；heat={value:非负数字或null,unit:非空字符串,text:字符串}。不能从列表下标推断排名或伪造热度。
HotRankScript.run(ctx) 返回 {kind:'hot_rank',observed_at,entries,...} 的 Result；置顶在前；其余排名全部已知时按 rank 升序，有未知 rank 时保留上游次序，不按热度重新排。observed_at 是采集时间，不是 published。此输出没有 items，只能普通路由或 Debug 查看，不能直接走 /rss、/atom 生成 RSS 源。
模块可 export const kind="hot" 或 "rss"，兼容旧 script_type；未声明时按顶部 /** HOT */ 或 /** RSS */，再按基类推断。迁移前无标记的 NewsNow 和 Instagram 示例兼容归为 hot，其余旧普通脚本默认为 rss。列表接口支持 ?kind=hot|rss。/admin/scripts 的标题是 Hot/RSS Tabs，Tab 内筛选、数量和列表按 kind 只展示当前类型，新增使用对应类型的默认脚本。迁移示例分别在 examples/hot（53 个）与 examples/rss（17 个），严格按原文件顶部 /** RSS */ 分类，不自动导入管理后台。route.path 不包含 /rss、/atom、/debug 前缀。新增脚本可存 draft，发布为 published 且 enabled 才生效；回退 draft 后不参与正式路由。脚本助手只能修改未保存草稿和 Debug，不能自行保存/发布/回退，全局助手不能声称修改脚本。

route.platform 是平台名称或标识字符串（如“知乎”或“zhihu”），缺省为“网页”。保存脚本后平台自动出现在订阅源管理与首页筛选；支持自定义名称与多路由各自的平台。route.maintainers 支持多个 {nickname,url,avatar} 对象，也兼容字符串数组；nickname 必填，url/avatar 可空，非空必须是无凭据 HTTP(S) 地址。

四、显式 Cookie 权限与日志
ctx.fetchText 默认匿名，宿主不按 URL 自动注入 Cookie，不能填写 headers.Cookie。模块导出 permissions.cookies=[{id,origin,path_prefix,names,purpose}]：origin 是完整公网 HTTPS origin，无路径；path_prefix 是规范绝对路径；names 明确列出非空 Cookie 名称，不用通配符；purpose 说明读取用途。
管理员确认当前源码和权限后，await ctx.cookies.get(id) 得到 Result<句柄>；传入 fetchText(url,{cookies:result.data}) 或 utils.request_text/request_json 的 options。脚本拿不到 Cookie 明文，不能把句柄当字符串或手写 Cookie 头；宿主校验名称、域、路径、有效期和重定向。源码变更要重新确认，撤销后不能继续使用。AI 不能代替用户确认授权。
ctx.log(...args)/ctx.error(...args) 收集 info/error 日志，自身不抛错；ctx.error 记录日志，不会中止脚本，失败应 return Result.Err。日志不要记录凭证或账户页面正文。Debug 的输出、上下文、日志是三个 Tab，可以查看抓取、解析条目数量和错误的效果。
这些 SDK 约定仅适用于 findrss-worker QuickJS；Go/goja 暂不支持此内置模块和全局基类。下面的 example.com、Cookie 名称和数据结构仅为模板，必须根据真实网站、回包与用户授权替换。

五、RSSScript 与工具模块示例（返回 feed，由 /rss 或 /atom 渲染）
\`\`\`js
${SCRIPT_AGENT_UTIL_EXAMPLE}
\`\`\`

六、HotRankScript 示例（普通路由 JSON；上游需提供 entries 的 id/title/link/rank/pinned/heat）
\`\`\`js
${SCRIPT_AGENT_HOT_RANK_EXAMPLE}
\`\`\`

七、Cookie 授权示例（普通路由 HTML；执行前必须由管理员确认）
\`\`\`js
${SCRIPT_AGENT_COOKIE_EXAMPLE}
\`\`\`
`;
