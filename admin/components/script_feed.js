import xml_parser from "fast-xml-parser/src/fxp.js";
import { create_feed_parser } from "../../packages/feed-fetch/src/feed_parser.js";
import { FeedModel } from "../../server/domain/feed_format.js";
import { script_preview_asset_url } from "../domain/script_preview.js";
import { PaginationModel, PaginationView } from "./pagination.js";

const { parse_feed_document } = create_feed_parser(xml_parser.XMLParser, xml_parser.XMLValidator);

function safe_url(value, base) {
  if (!value) return "";
  try {
    const url = new URL(value, base || undefined);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

// 预览只生成文本节点和安全的 HTTP 链接，不把响应中的 HTML 注入管理页。
function plain_text(value) {
  return String(value || "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function format_time(value) {
  const date = new Date(value);
  const pad = value => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScriptFeedPreviewModel(source, request_url = "", preview_assets = null) {
  if (!source) return { xml: "", feed: null, error: "", empty: true };
  let xml = source;
  try {
    // RSSScript 返回协议无关 feed JSON；与公开 /rss 路由使用相同的序列化器。
    if (/^\s*[\[{]/.test(source)) {
      const value = JSON.parse(source);
      xml = FeedModel.fromValue(value).render("rss", { self_url: request_url });
    }
    const parsed = parse_feed_document(xml, request_url);
    const site_url = safe_url(parsed.site_url, request_url);
    const image_url = value => {
      const address = safe_url(value, site_url);
      return script_preview_asset_url(address, preview_assets);
    };
    return { xml, empty: false, error: "", feed: {
      title: plain_text(parsed.title), description: plain_text(parsed.description),
      site_url, icon: image_url(parsed.icon), kind: parsed.kind,
      articles: parsed.articles.map((article, index) => ({
        key: JSON.stringify([index, article]), title: plain_text(article.title),
        link: safe_url(article.link, site_url),
        summary: plain_text(article.summary || article.content_html),
        thumbnail: image_url(article.thumbnail),
        published_at: article.published_at,
      })),
    } };
  } catch (error) {
    return { xml, feed: null, empty: false, error: "无法生成预览：" + error.message };
  }
}

export function ScriptFeedPreviewView(ui, { preview }) {
  const { View, Card, Link, Img, For, Show, computed, combine } = ui;
  const read = map => computed(preview, map);
  const articles = read(result => result.feed?.articles || []);
  const pagination = PaginationModel(ui, { total: computed(articles, items => items.length) });
  const paged = combine({ articles, page: pagination.state }, ({ articles, page }) =>
    articles.slice(page.page * page.page_size, (page.page + 1) * page.page_size));
  const text = (name, value, class_name = "text-muted text-sm") => View({
    class: "box-border break-anywhere " + class_name, attributes: { n: "script-feed-" + name },
  }, [value]);
  const image = (name, src, size) => Img({
    src, class: "box-border flex-none object-cover rounded-control",
    style: { width: size, height: size },
    attributes: { n: "script-feed-" + name, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
  });
  const title = (name, value, href) => href
    ? Link({ href, target: "_blank", class: "box-border break-anywhere", attributes: {
      n: "script-feed-" + name, rel: "noopener noreferrer",
    } }, [value])
    : text(name, value, "text-base");
  return View({ class: "box-border min-w-0", attributes: { n: "script-feed-preview" } }, [
    Show({ when: read(result => result.empty), ok: () => text("empty", "运行调试后查看频道和内容列表") }),
    Show({ when: read(result => Boolean(result.error)), ok: () => View({
      class: "box-border text-danger break-anywhere", attributes: { n: "script-feed-error", role: "alert" },
    }, [read(result => result.error)]) }),
    Show({ when: read(result => Boolean(result.feed)), ok: () => View({
      class: "box-border grid min-w-0", style: { gap: "var(--frui-space-5)" },
    }, [
      Card({ attributes: { n: "script-feed-channel" } }, [
        View({ class: "box-border flex items-start", style: { gap: "var(--frui-space-3)" } }, [
          Show({ when: read(result => Boolean(result.feed?.icon)), ok: () =>
            image("icon", read(result => result.feed.icon), "var(--frui-space-6)") }),
          View({ class: "box-border grid min-w-0", style: { gap: "var(--frui-space-2)" } }, [
            Show({ when: read(result => Boolean(result.feed?.site_url)),
              ok: () => title("channel-title", read(result => result.feed.title), read(result => result.feed.site_url)),
              fail: () => text("channel-title", read(result => result.feed?.title || ""), "text-base"),
            }),
            text("description", read(result => result.feed?.description || "")),
            text("site-url", read(result => result.feed?.site_url || "")),
            text("count", read(result => `${(result.feed?.kind || "").toUpperCase()} · ${result.feed?.articles.length || 0} 条内容`)),
          ]),
        ]),
      ]),
      Show({ when: computed(articles, items => items.length === 0),
        ok: () => text("no-items", "频道暂无内容条目") }),
      View({ as: "ol", class: "box-border grid m-0 p-0 min-w-0", style: {
        "list-style": "none", gap: "var(--frui-space-4)",
      }, attributes: { n: "script-feed-items", "aria-label": "订阅内容列表" } }, [
        For({ each: paged, key: "key", render(value) {
          const article = value?.__is_ref ? value.value : value;
          return View({ as: "li", class: "box-border flex min-w-0 items-start", style: {
            gap: "var(--frui-space-3)", "padding-bottom": "var(--frui-space-4)",
            "border-bottom": "1px solid var(--frui-color-border-soft)",
          }, attributes: { n: "script-feed-item" } }, [
            View({ class: "box-border grid min-w-0 flex-1", style: { gap: "var(--frui-space-2)" } }, [
              title("item-title", article.title, article.link),
              ...(article.published_at ? [text("item-time", format_time(article.published_at))] : []),
              text("item-summary", article.summary),
            ]),
            ...(article.thumbnail ? [image("item-image", article.thumbnail, "calc(var(--frui-space-6) * 3)")] : []),
          ]);
        } }),
      ]),
      Show({ when: computed(articles, items => items.length > 0), ok: () =>
        PaginationView(ui, { model: pagination, name: "script-feed-pagination", label: "预览内容分页" }) }),
    ]) }),
  ]);
}
