// 脚本助手内置知识：字段与 server/domain/feed_format.js 的实际归一化、渲染行为一致。
// 示例也作为可执行契约，经测试送入 FeedModel 渲染 RSS/Atom，避免只验证提示词文案。
function freeze_example(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze_example(child);
    Object.freeze(value);
  }
  return value;
}

export const SCRIPT_AGENT_FEED_EXAMPLE = freeze_example({
  title: "示例订阅源",
  link: "https://example.com/",
  description: "示例网站的最新文章",
  language: "zh-CN",
  id: "https://example.com/",
  author: { name: "编辑部", email: "editor@example.com", uri: "https://example.com/about" },
  image: { url: "https://example.com/logo.png", title: "示例网站", link: "https://example.com/" },
  updated: "2026-10-14T08:00:00Z",
  items: [{
    id: "https://example.com/articles/123",
    type: "article",
    title: "示例文章",
    link: "https://example.com/articles/123",
    description: "文章摘要",
    content: '<p>完整正文，保留 HTML。<a href="https://example.com/?a=1&b=2">原文链接</a></p>',
    author: { name: "示例作者", email: "author@example.com", uri: "https://example.com/authors/1" },
    published: "2026-10-14T07:30:00Z",
    updated: "2026-10-14T08:00:00Z",
    image: "https://example.com/articles/123/cover.jpg",
    categories: ["科技", "新闻"],
  }],
});

export const SCRIPT_AGENT_MEDIA_FEED_EXAMPLE = freeze_example({
  title: "图片和视频示例",
  link: "https://example.com/media",
  description: "附件与动态照片的返回格式",
  updated: "2026-10-14T08:00:00Z",
  items: [{
    id: "gallery-1", type: "gallery", title: "多图动态", link: "https://example.com/posts/gallery-1",
    description: "图片说明", image: "https://example.com/cover.jpg",
    images: ["https://example.com/photo-1.jpg", "https://example.com/photo-2.jpg"],
    media_group: true,
  }, {
    id: "video-1", type: "video", title: "视频动态", link: "https://example.com/posts/video-1",
    description: "视频说明", image: "https://example.com/video-cover.jpg",
    enclosure: { url: "https://example.com/video.mp4", type: "video/mp4", length: 123456, key: "example-video-key" },
  }, {
    id: "live-photo-1", type: "live", title: "动态照片", link: "https://example.com/posts/live-photo-1",
    live_photos: [{ image: "https://example.com/live.jpg", video: "https://example.com/live.mp4", key: "example-live-video-key", width: 1080, height: 1920 }],
  }],
});

export const SCRIPT_AGENT_FEED_KNOWLEDGE = `
FindRSS feed JSON → XML 返回格式知识（以本项目 FeedModel 渲染器为准）：
以下规则适用于 RSSScript 和 /rss、/atom 订阅输出；HotRankScript 的普通路由输出 entries 榜单快照，不适用 items/XML 规则。

一、返回结构与必填规则
route.handler(ctx) 可 return Result.Ok(feed)，宿主展开 data 后再渲染；Result.Err 由宿主映射为错误。下述结构说明均针对成功的 feed 数据对象。脚本也可直接 return 一个可 JSON 序列化的普通对象，顶层 items 必须是数组，即使没有文章也必须返回 items: []。
顶层 feed 对象就是 RSS <channel> 的数据；items 中每个对象就是一个 <item>，Atom 中对应 <feed>/<entry>。
不要返回 { channel: {...} }、{ rss: { channel: {...} } }、{ feed: {...} }、{ data: {...} }、单独的 item 数组、JSON.stringify(feed)、XML 字符串或 { body: XML, content_type: ... } 来生成订阅 XML。
最低结构闸门仅要求对象和 items 数组；为了让订阅阅读器可靠显示，实际脚本应提供 feed.title/link/description，item.title/link/id，以及真实的发布时间；生成 Atom 时也应提供 feed.updated。
未知字段会被忽略。缺省或空白字段通常不输出 XML 元素，非对象的 items 成员会被丢弃；不要靠错误字段名碰运气。

二、channel / feed 字段（位于顶层）
title: string → RSS channel/title；Atom feed/title。订阅源名称。
link: string → RSS channel/link；Atom alternate link。源网站的绝对 HTTP(S) 地址，不是 RSS 订阅地址。
description: string → RSS channel/description；Atom subtitle。订阅源介绍。
language: string → RSS channel/language；Atom feed 的 xml:lang，例如 zh-CN。
updated: 时间 → RSS channel/lastBuildDate；Atom feed/updated。
id: string → Atom feed/id；RSS channel 不输出这个字段。Atom id 缺省依次使用 link、服务端 self URL、urn:findrss:feed。
author: 作者字符串或 { name, email, uri } → Atom feed/author。RSS channel 不输出 author；不能把它当成 RSS managingEditor。
image: 图片 URL 字符串或 { url, title, link } → RSS channel/image（url/title/link）；Atom logo 只取 url。要生成完整 RSS image，推荐对象并填写三项。
extra: 普通 JSON 对象 → RSS channel 或 Atom feed 下的 findrss:extra，内部为转义后的 JSON 文本。序列化长度超过 16384 字符时被忽略；它不是任意 XML 扩展标签接口。
items: 对象数组 → RSS item 列表 / Atom entry 列表。
不要使用 channel.pubDate、lastBuildDate、ttl、generator、copyright、managingEditor 等原生 RSS 字段名；当前 JSON 模型不识别这些字段，更新时间应使用 updated。

三、item / entry 字段（items 数组成员）
id: string → RSS guid；Atom entry/id。应使用稳定的文章 ID 或永久原文链接，不用随机值、列表下标或每次请求时间作为文章 ID。
link: string → RSS item/link；Atom alternate link。文章原文的绝对地址。RSS guid 回退到 link；仅当 guid 等于 HTTP(S) link 时 isPermaLink=true，否则 false。Atom entry id 回退到 link，再到 feed id + #序号。
title: string → RSS item/title；Atom entry/title。
description: string → RSS item/description；Atom summary type="html"。摘要，可含 HTML。
content: string → RSS content:encoded；Atom content type="html"。完整正文 HTML；不能用 content:encoded、content_html、body 等作为 JSON 字段名。
author: 作者字符串或 { name, email, uri } → RSS dc:creator（name → email → uri 取第一个非空值）；Atom author（name/email/uri）。
published: 时间 → RSS pubDate；Atom published。JSON 字段名必须为 published，而不是 pubDate、date、pub_date。
updated: 时间 → Atom updated；RSS item 不单独输出 updated。Atom entry 更新时间依次回退到 item.updated、item.published、feed.updated；全部缺省时不会自动补当前时间。
categories: string[] → RSS 每项一个 category；Atom 每项一个 category term。必须用字符串数组，不能使用 category 或 categories 对象数组。
image: string → media:thumbnail url。item 的封面仅接受 URL 字符串；与顶层 image 不同，不能传 { url: ... }。
images: string[] → 每张图片一个 media:content medium="image"；与封面 image 可并存。
enclosure: { url: string, type?: string, length?: number|string, key?: string } → RSS enclosure + media:content；Atom enclosure link + media:content。url 必须非空，type 是 MIME 类型，例如 video/mp4、audio/mpeg、image/jpeg；length 是文件字节数，不是时长，已知时填写；key 是可选的附件解密密钥，仅在上游实际提供时填写。
video: string → enclosure 的快捷写法，默认 type="video/mp4"；存在有效 enclosure 时以 enclosure 为准。不要用 video 对象或 attachments 数组代替。
type: "article" | "gallery" | "video" | "live" → RSS 带 domain="urn:content-type" 的 category；Atom 带 scheme="urn:content-type" 的 category。其他值被忽略。
media_group: true → 将媒体内容聚合在 media:group，包含 media:title/media:description；RSS enclosure 仍在 item 下。存在有效 live_photos 时不再建立外层 media_group。
live_photos: [{ image: string, video: string, key?: string, width?: number, height?: number }] → 每对照片与视频各生成一个 media:group，静态图 media:content medium="image" isDefault="true"，动态视频 media:content medium="video" type="video/mp4" 并携带缩略图、key、尺寸。image/video 均须非空；动态视频的 key 必须来自该视频，不能拿静态图片的密钥替代。如同一图片也在 images 中，渲染器会合并而不重复输出配对组。

四、时间、HTML、地址和序列化
时间接受正的有限数值（小于 1e12 按 Unix 秒，其余按 Unix 毫秒），或可解析的日期字符串（推荐带时区的 ISO 8601）；不能用数字字符串代替数值时间戳。无效/空时间会被忽略。RSS 使用 UTC 日期，Atom 使用 ISO 8601。
正文、标题和摘要直接传原始字符串，HTML 直接放入 content/description；服务端统一转义 XML 文本与属性，并移除 XML 1.0 非法控制字符。脚本不要预先转义 &/< />、拼 CDATA、手写命名空间或使用不存在的 ctx.xmlEscape；否则会二次转义。
网站抓取到相对地址时先根据原文/网站地址转换为绝对地址；有 origin 需求时可使用 ctx.public_origin。RSS/Atom 的 self link 与命名空间由服务端生成。
同一 route 声明 path 不加 /rss、/atom 或 /debug 前缀；例如 path="/example/:id" 可经 /rss/example/123 得到 RSS 2.0，经 /atom/example/123 得到 Atom 1.0，复用相同的 feed JSON 和缓存。
普通路径和 /debug 的原始输出可以是 JSON；只有 /rss 与 /atom 包装器把 feed JSON 序列化为订阅 XML。Debug 里的 JSON 输出本身不代表失败，仍需按上述结构检查 channel 和 item 的映射。
不要把示例中的 example.com 地址、文章、发布时间或解密密钥当作抓取结果；生成真实脚本时用真实上游数据，缺失的可选内容省略，不伪造正文、附件或时间。

五、可返回的完整文章 feed JSON 示例（handler 中 return 此对象；按实际来源替换示例数据）
\`\`\`json
${JSON.stringify(SCRIPT_AGENT_FEED_EXAMPLE, null, 2)}
\`\`\`

六、多图、视频附件、动态照片 feed JSON 示例（可选能力，不必给每篇文章填满所有字段）
\`\`\`json
${JSON.stringify(SCRIPT_AGENT_MEDIA_FEED_EXAMPLE, null, 2)}
\`\`\`
`;
