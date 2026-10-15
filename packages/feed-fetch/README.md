# @findrss/feed-fetch

API Worker 与阅读端共用的无状态抓取内核：公网 URL 校验、重定向、请求配置、RSS/Atom/JSON Feed 解析和 HTML 正文抽取。

JSON Feed 支持版本 1 与 1.1，按响应内容自动识别，不依赖 URL 后缀或 Content-Type。预览、加源与刷新共用解析入口，输出 `kind: "json"`；标题、说明、图标、文章 ID、链接、发布时间、HTML/纯文本正文及图片/音视频附件映射为现有 feed/article 形状。纯文本转义后保留换行；未知扩展忽略，不自动请求 `next_url` 分页。

```js
import { create_feed_parser, fetch_feed } from "@findrss/feed-fetch";
import { XMLParser, XMLValidator } from "fast-xml-parser/src/fxp.js";

const { parse_feed_document } = create_feed_parser(XMLParser, XMLValidator);
const feed = await fetch_feed({ feed_url, settings, options, parse_feed: parse_feed_document });
```

它不读数据库、不依赖 Cloudflare binding，也不执行网页 JavaScript。需要站点专用 JavaScript 时，由调用方在抓取 HTML 后接自己的 QuickJS 处理器。

订阅源 XML 最多读取 16 MiB，支持包含多年历史节目的大型播客源；有无 `Content-Length` 都会按实际响应字节检查，超限即取消读取。原文 HTML 的默认上限仍为 8 MiB。

`fetch_feed_document` 返回 `size_bytes` 和 `size_source`：成功读取时为实际 XML 字节数（`actual`），未读完时可返回服务器声明的 `Content-Length`（`server`），未知时为 `null`。音频附件本身不在该大小内。

成功 HTTP 响应的正文为空或只有空白时，抓取层返回「订阅源返回了空内容」及 HTTP 状态，不交给 XML 解析器，也不保存该响应的 ETag/Last-Modified。合法 RSS/Atom/JSON Feed 中没有文章的情况仍正常解析；304 条件响应继续按未变化处理。

订阅源默认下载预算为 60 秒，涵盖所有重定向、响应头及完整 XML 读取；调用方可用 `timeout_ms` 覆盖。原文 HTML 的默认预算保持 15 秒。XML 下载过程中超时也会返回 `timed_out: true` 与「订阅源读取超时」。

XML 普通实体展开次数按文档字符数设置有限上限，避免大量转义 HTML 正文触发解析器默认 1000 次限制。自定义实体大小、数量、深度及展开长度仍保留限制；解析失败回传具体原因，语法校验失败附行列位置。

Live Photo 使用标准 Media RSS 结构：每张图片的静态与动态版本放在独立 `media:group` 中，静态 `media:content medium="image" isDefault="true"`，动态 `media:content medium="video"` 的 `media:thumbnail` 指向静态原图。解析器仅在同组恰有这两个媒体节点且缩略图匹配时合并为 `live_photo`；这是阅读器的识别约定，不是 Media RSS 定义的 Live Photo 类型。无需私有命名空间。

每条记录可通过 RSS `<category domain="urn:content-type">article|gallery|video|live</category>` 或 Atom `<category scheme="urn:content-type" term="article|gallery|video|live" />` 声明类型，解析为 `article.type`。这是使用标准 category 的类型词表约定，未声明时保留原来的媒体推断兼容。
