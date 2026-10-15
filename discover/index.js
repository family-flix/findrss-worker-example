import {
  Button,
  For,
  Img,
  Input,
  Link,
  Show,
  View,
  combine,
  computed,
  ref,
} from "timeless";

import {
  plain_text,
  safe_http_url,
  safe_avatar_url,
} from "../server/lib/discovery_sources.js";
import { logo_url, platform_icons } from "./icons.js";
import { platform_icon_url } from "../server/lib/discovery_platform.js";
import { LazyAvatar, LazyImg } from "./lazy_img.js";

export const routes_configure = {
  home: {
    pathname: "/",
    aliases: ["/index.html"],
    title: "RSS 订阅广场",
    page: "Home",
  },
};

export function match_discovery_route(pathname) {
  for (const [name, route] of Object.entries(routes_configure)) {
    if (route.pathname === pathname || route.aliases?.includes(pathname))
      return { name, ...route };
  }
  return null;
}

const default_platforms = [{ id: "website", label: "网页" }];
const search_debounce_ms = 350;
const copy_status_ms = 2000;
export const SOURCE_PAGE_SIZE = 20;

function format_time(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  const date = new Date(
    timestamp > 100000000000 ? timestamp : timestamp * 1000,
  );
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", { hour12: false });
}

function normalize_feed(item) {
  const feed_url = safe_http_url(item.feed_url);
  if (!feed_url) return null;
  const website = safe_http_url(item.website);
  return {
    title: String(item.title || "未命名订阅源").slice(0, 160),
    description: plain_text(item.description, 260),
    website,
    feed_url,
    language: String(item.language || "")
      .slice(0, 12)
      .toUpperCase(),
    subscribers: Number(item.subscribers || 0),
    velocity: Number(item.velocity || 0),
    tags: (Array.isArray(item.tags)
      ? item.tags
      : Array.isArray(item.topics)
        ? item.topics
        : []
    ).map(String),
    managed: true,
    require_token: item.require_token === true,
    public:
      typeof item.public === "boolean"
        ? item.public
        : /^\/(rss|atom)\//.test(new URL(feed_url).pathname) &&
          item.require_token !== true,
    source_id: String(item.id || item.source_id || ""),
    source_type: String(item.source_type || ""),
    avatar_url: safe_avatar_url(item.avatar_url),
    snapshot: {
      saved_at: Number(item.snapshot?.saved_at || 0),
      articles: (Array.isArray(item.snapshot?.articles)
        ? item.snapshot.articles
        : []
      )
        .slice(0, 3)
        .map((article, index) => ({
          id: String(index),
          title: plain_text(article.title, 180) || "无标题",
          link: safe_http_url(article.link),
          published_at: format_time(article.published_at),
          cover_url: safe_http_url(article.cover_url),
          cover_blurhash: String(article.cover_blurhash || ""),
          cover_width: Math.max(
            0,
            Math.floor(Number(article.cover_width) || 0),
          ),
          cover_height: Math.max(
            0,
            Math.floor(Number(article.cover_height) || 0),
          ),
        })),
    },
  };
}

export function DiscoveryViewModel(catalog = null) {
  let catalog_pending = null;
  const query_ = ref("");
  const selected_platform_ = ref("");
  const platforms_ = ref(default_platforms);
  const selected_tags_ = ref([]);
  const available_tags_ = ref([]);
  const feeds_ = ref([]);
  const page_ = ref(0);
  const total_count_ = ref(0);
  const loading_ = ref(false);
  const error_ = ref("");
  let search_timer = 0;
  let search_sequence = 0;
  let initialized = false;
  const copy_entries = new Map();

  function read_location() {
    const parameters = new URL(window.location.href).searchParams;
    query_.set((parameters.get("q") || "").slice(0, 100));
    const platform = parameters.get("source_type") || "";
    selected_platform_.set(
      platform.length <= 64 && !/[\u0000-\u001f\u007f]/.test(platform)
        ? platform
        : "",
    );
    selected_tags_.set(
      [
        ...new Set(
          parameters
            .getAll("tag")
            .map((tag) => tag.trim())
            .filter((tag) => tag && tag.length <= 32 && !/[\r\n]/.test(tag)),
        ),
      ].slice(0, 13),
    );
    const page = Number(parameters.get("page"));
    return Number.isSafeInteger(page) && page > 0
      ? Math.min(page - 1, 50000)
      : 0;
  }

  function sync_location(page, history_mode) {
    const url = new URL(window.location.href);
    for (const key of ["page", "q", "source_type", "tag"])
      url.searchParams.delete(key);
    if (page > 0) url.searchParams.set("page", String(page + 1));
    if (query_.value.trim()) url.searchParams.set("q", query_.value.trim());
    if (selected_platform_.value)
      url.searchParams.set("source_type", selected_platform_.value);
    selected_tags_.value.forEach((tag) => url.searchParams.append("tag", tag));
    if (url.href !== window.location.href) {
      window.history[history_mode === "replace" ? "replaceState" : "pushState"](
        null,
        "",
        url.href,
      );
    }
  }

  function restore_location() {
    clearTimeout(search_timer);
    search_timer = 0;
    return load_sources(read_location(), "replace");
  }

  function init() {
    if (!initialized) {
      window.addEventListener("popstate", restore_location);
      initialized = true;
    }
    return restore_location();
  }

  function copy_entry(feed_url) {
    if (!copy_entries.has(feed_url))
      copy_entries.set(feed_url, { state: ref("idle"), timer: 0 });
    return copy_entries.get(feed_url);
  }

  const article_cache = new Map();

  function article_entry(feed) {
    if (!article_cache.has(feed.feed_url)) {
      article_cache.set(feed.feed_url, {
        state: ref({
          status: feed.snapshot.saved_at ? "ready" : "missing",
          items: feed.snapshot.articles,
          error: "",
        }),
      });
    }
    return article_cache.get(feed.feed_url);
  }

  function hide_article_cover(feed, item_id) {
    const entry = article_entry(feed);
    entry.state.set({
      ...entry.state.value,
      items: entry.state.value.items.map((item) =>
        item.id === item_id ? { ...item, cover_url: "" } : item,
      ),
    });
  }

  async function load_sources(page = 0, history_mode = "push") {
    const sequence = ++search_sequence;
    loading_.set(true);
    error_.set("");
    try {
      if (!catalog) {
        catalog_pending ||= fetch("/api/catalog", {
          headers: { Accept: "application/json" },
        })
          .then(async (response) => {
            const payload = await response.json();
            if (!response.ok)
              throw new Error(payload.error || "订阅源加载失败");
            if (!Array.isArray(payload.sources))
              throw new Error("订阅源目录格式错误");
            return payload;
          })
          .catch((error) => {
            catalog_pending = null;
            throw error;
          });
        catalog = await catalog_pending;
      }
      if (sequence !== search_sequence) return;
      apply_catalog(page);
      sync_location(page_.value, history_mode);
    } catch (load_error) {
      if (sequence !== search_sequence) return;
      error_.set(
        load_error instanceof Error ? load_error.message : "订阅源加载失败",
      );
      feeds_.set([]);
    } finally {
      if (sequence === search_sequence) loading_.set(false);
    }
  }

  function apply_catalog(page = 0) {
    platforms_.set(
      Array.isArray(catalog.platforms)
        ? catalog.platforms.map(({ id, name, label, icon }) => ({ id, label: name || label, ...(icon === undefined ? {} : { icon }) }))
        : default_platforms,
    );
    if (
      selected_platform_.value &&
      !platforms_.value.some(
        (platform) => platform.id === selected_platform_.value,
      )
    )
      selected_platform_.set("");
    const query = query_.value.trim().toLowerCase();
    const sources = catalog.sources.filter(
      (source) =>
        (!selected_platform_.value ||
          source.source_type === selected_platform_.value) &&
        selected_tags_.value.every((tag) => source.tags?.includes(tag)) &&
        (!query ||
          [
            source.title,
            source.description,
            source.website,
            source.feed_url,
            ...(source.tags || []),
          ].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(query),
          )),
    );
    const total = sources.length;
    const current_page = Math.min(
      page,
      Math.max(0, Math.ceil(total / SOURCE_PAGE_SIZE) - 1),
    );
    page_.set(current_page);
    total_count_.set(total);
    article_cache.clear();
    feeds_.set(
      sources
        .slice(
          current_page * SOURCE_PAGE_SIZE,
          (current_page + 1) * SOURCE_PAGE_SIZE,
        )
        .map(normalize_feed)
        .filter(Boolean),
    );
    available_tags_.set([
      ...new Set([
        ...(catalog.tags || []),
        ...selected_tags_.value,
      ]),
    ]);
  }

  function queue_search(query) {
    page_.set(0);
    query_.set(String(query || "").slice(0, 100));
    ++search_sequence;
    clearTimeout(search_timer);
    search_timer = 0;
    loading_.set(true);
    search_timer = setTimeout(() => {
      search_timer = 0;
      load_sources();
    }, search_debounce_ms);
  }

  function submit_search(query) {
    page_.set(0);
    query_.set(String(query || "").slice(0, 100));
    clearTimeout(search_timer);
    search_timer = 0;
    return load_sources();
  }

  function select_platform(platform) {
    if (
      platform &&
      !platforms_.value.some((entry) => entry.id === platform) &&
      catalog
    )
      return;
    selected_platform_.set(platform);
    page_.set(0);
    clearTimeout(search_timer);
    search_timer = 0;
    return load_sources();
  }

  function select_tag(tag_name) {
    const tag = String(tag_name || "").trim();
    if (!tag || tag.length > 32 || /[\r\n]/.test(tag)) return;
    const current = selected_tags_.value;
    if (!current.includes(tag) && current.length >= 13) return;
    selected_tags_.set(
      current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag],
    );
    page_.set(0);
    clearTimeout(search_timer);
    search_timer = 0;
    return load_sources();
  }

  function clear_tags() {
    page_.set(0);
    selected_tags_.set([]);
    clearTimeout(search_timer);
    search_timer = 0;
    return load_sources();
  }

  function select_page(value) {
    if (loading_.value || search_timer) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const last = Math.max(
      0,
      Math.ceil(total_count_.value / SOURCE_PAGE_SIZE) - 1,
    );
    const page = Math.max(0, Math.min(last, Math.floor(number)));
    if (page === page_.value) return;
    return load_sources(page);
  }

  async function copy_feed_url(feed_url) {
    const entry = copy_entry(feed_url);
    if (entry.state.value === "copying") return;
    clearTimeout(entry.timer);
    entry.state.set("copying");
    try {
      await navigator.clipboard.writeText(feed_url);
      entry.state.set("copied");
    } catch {
      entry.state.set("error");
    }
    entry.timer = setTimeout(() => entry.state.set("idle"), copy_status_ms);
  }

  if (catalog) apply_catalog();

  return {
    state: {
      query: query_,
      selected_platform: selected_platform_,
      platforms: platforms_,
      platform_filters: computed(platforms_, (platforms) => [
        { id: "", label: "全部" },
        ...platforms,
      ]),
      selected_tags: selected_tags_,
      available_tags: available_tags_,
      feeds: feeds_,
      page: page_,
      total_count: total_count_,
      loading: loading_,
      error: error_,
    },
    methods: {
      init,
      queue_search,
      submit_search,
      select_platform,
      select_tag,
      clear_tags,
      select_page,
      articles_for: (feed) => article_entry(feed).state,
      hide_article_cover,
      copy_status: (feed_url) => copy_entry(feed_url).state,
      copy_feed_url,
    },
  };
}

function format_count(value) {
  const number = Number(value || 0);
  if (number >= 10000)
    return (number / 10000).toFixed(number >= 100000 ? 0 : 1) + " 万订阅";
  return number + " 订阅";
}

// 接口加载前使用本地默认值；实际平台列表由接口返回。
const DISCOVERY_PLATFORM_LABELS = {
  douyin: "抖音",
  wxchannels: "视频号",
  wxmp: "公众号",
  zhihu: "知乎",
  x: "X",
  xiaohongshu: "小红书",
  bilibili: "哔哩哔哩",
  weibo: "微博",
  kuaishou: "快手",
  youtube: "YouTube",
  instagram: "Instagram",
  telegram: "Telegram",
  website: "网页",
};

function discovery_platform_label(id, platforms = []) {
  const platform = platforms.find((platform) => platform.id === id);
  if (platform) return platform.label;
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id)
    ? DISCOVERY_PLATFORM_LABELS[id]
    : id;
}

function discovery_platform_icon(id) {
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id) ? id : "website";
}

function discovery_platform_icon_url(id, platforms) {
  return platform_icon_url(platforms.find(platform => platform.id === id)?.icon)
    || platform_icons[id ? discovery_platform_icon(id) : "all"];
}

/** @param {unknown} raw */
function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

/** 过滤掉不渲染的分支，免得子节点里留下 null/空串。 */
function compact_nodes(nodes) {
  return nodes.filter(
    (node) => node !== null && node !== undefined && node !== "",
  );
}

/**
 * 用 `.meta-dot` 顿点隔开若干条目。
 * 首尾不出现顿点，所以入参必须先 `compact_nodes` 过一遍：`Show` 会留下占位节点，
 * 混进来就会多出一个孤立的顿点。
 */
function dotted_nodes(entries) {
  const children = [];
  compact_nodes(entries).forEach((entry, index) => {
    if (index > 0) {
      children.push(
        View(
          {
            class: "meta-dot",
            attributes: { n: "feed-meta-dot", "aria-hidden": "true" },
          },
          [],
        ),
      );
    }
    children.push(entry);
  });
  return children;
}

/** 搜索独立放在 Logo 下方。 */
export function HeaderView() {
  return View({ class: "masthead", attributes: { n: "masthead" } }, [
    View({ class: "shell", attributes: { n: "masthead-shell" } }, [
      View({ class: "masthead-inner", attributes: { n: "masthead-inner" } }, [
        Link(
          {
            class: "brand-lockup",
            href: "./",
            attributes: {
              n: "brand-lockup",
              href: "./",
              "aria-label": "RSS 订阅广场首页",
            },
          },
          [
            Img({
              class: "brand-mark",
              attributes: { n: "brand-mark", alt: "", decoding: "async" },
              src: logo_url,
            }),
            View({ class: "brand-column", attributes: { n: "brand-column" } }, [
              View(
                {
                  class: "brand-wordmark",
                  attributes: { n: "brand-wordmark" },
                },
                [
                  View(
                    {
                      class: "brand-wordmark-find",
                      attributes: { n: "brand-wordmark-find" },
                    },
                    ["Find"],
                  ),
                  View(
                    {
                      class: "brand-wordmark-rss",
                      attributes: { n: "brand-wordmark-rss" },
                    },
                    ["RSS"],
                  ),
                ],
              ),
            ]),
          ],
        ),
        Link(
          {
            class: "github-link",
            href: "https://github.com/ltaoo/findrss-worker",
            attributes: {
              n: "github-link",
              href: "https://github.com/ltaoo/findrss-worker",
              target: "_blank",
              rel: "noopener noreferrer",
              "aria-label": "FindRSS GitHub 仓库（新标签页打开）",
              title: "GitHub",
            },
          },
          [
            View({
              class: "github-icon",
              attributes: { n: "github-icon", "aria-hidden": "true" },
            }, []),
          ],
        ),
      ]),
    ]),
  ]);
}

export function SearchView({ vm$ }) {
  return View(
    {
      class: "shell search-row",
      attributes: { n: "discovery-search-row", role: "search" },
    },
    [
      View({ class: "masthead-search", attributes: { n: "masthead-search" } }, [
        View(
          {
            class: "search-icon",
            attributes: { n: "search-icon", "aria-hidden": "true" },
          },
          [],
        ),
        Input({
          class: "search-input",
          value: vm$.state.query,
          placeholder: "搜索已添加的订阅源",
          attributes: {
            n: "search-input",
            "aria-label": "搜索订阅源",
            type: "search",
            autocomplete: "off",
          },
          onInput(event) {
            vm$.methods.queue_search(event.target.value);
          },
          onKeyDown(event) {
            if (event.key === "Enter") {
              event.preventDefault();
              vm$.methods.submit_search(event.target.value);
            }
          },
        }),
      ]),
    ],
  );
}

export function TagNavigationView({ vm$ }) {
  return View(
    {
      class: "filter-row",
      attributes: {
        n: "tag-filters",
        role: "group",
        "aria-label": "标签多选筛选",
      },
    },
    [
      View({ class: "filter-label", attributes: { n: "tag-filter-label" } }, [
        "标签",
      ]),
      View(
        { class: "filter-options", attributes: { n: "tag-filter-options" } },
        [
          Button(
            {
              class: computed(
                vm$.state.selected_tags,
                (tags) =>
                  "filter-chip" + (tags.length === 0 ? " is-selected" : ""),
              ),
              attributes: {
                n: "tag-filter-all",
                type: "button",
                "aria-pressed": computed(vm$.state.selected_tags, (tags) =>
                  String(tags.length === 0),
                ),
              },
              onClick: vm$.methods.clear_tags,
            },
            ["全部"],
          ),
          For({
            each: vm$.state.available_tags,
            render(tag_value) {
              const tag = source_value(tag_value);
              return Button(
                {
                  class: computed(
                    vm$.state.selected_tags,
                    (tags) =>
                      "filter-chip" +
                      (tags.includes(tag) ? " is-selected" : ""),
                  ),
                  attributes: {
                    n: "tag-filter",
                    type: "button",
                    "aria-pressed": computed(vm$.state.selected_tags, (tags) =>
                      String(tags.includes(tag)),
                    ),
                  },
                  onClick() {
                    vm$.methods.select_tag(tag);
                  },
                },
                [tag],
              );
            },
          }),
        ],
      ),
    ],
  );
}

function FeedArticleView({ vm$, feed, item, articles }) {
  const cover_visible = computed(articles, (state) =>
    Boolean(state.items.find((article) => article.id === item.id)?.cover_url),
  );
  return View(
    {
      class: "feed-article",
      attributes: { n: "feed-article", role: "listitem" },
    },
    [
      Show({
        when: cover_visible,
        ok() {
          return LazyImg({ src: item.cover_url, blurhash: item.cover_blurhash,
            width: item.cover_width, height: item.cover_height });
        },
      }),
      View(
        { class: "feed-article-body", attributes: { n: "feed-article-body" } },
        [
          item.link
            ? Link(
                {
                  class: "feed-article-title",
                  href: item.link,
                  attributes: {
                    n: "feed-article-title",
                    href: item.link,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                },
                [item.title],
              )
            : View(
                {
                  class: "feed-article-title",
                  attributes: { n: "feed-article-title" },
                },
                [item.title],
              ),
          View(
            {
              class: "feed-article-time",
              attributes: { n: "feed-article-time" },
            },
            [item.published_at || "时间未知"],
          ),
        ],
      ),
    ],
  );
}

export function FeedArticlesView({ vm$, feed }) {
  const articles = vm$.methods.articles_for(feed);
  const message = computed(articles, (state) => {
    if (state.status === "error") return state.error;
    if (state.status === "ready") return state.items.length ? "" : "暂无文章";
    return feed.require_token
      ? "此订阅源需要访问凭证，暂时无法显示文章。"
      : "快照生成中";
  });
  return View(
    {
      class: "feed-articles",
      attributes: {
        n: "feed-articles",
        "aria-label": feed.title + "的最新文章",
      },
    },
    [
      Show({
        when: computed(message, Boolean),
        ok() {
          return View(
            {
              class: "feed-articles-state",
              attributes: { n: "feed-articles-state", role: "status" },
            },
            [message],
          );
        },
      }),
      View(
        {
          class: "feed-articles-list",
          attributes: { n: "feed-articles-list", role: "list" },
        },
        [
          For({
            key: "id",
            each: computed(articles, (state) => state.items.slice(0, 3)),
            render(item_value) {
              return FeedArticleView({
                vm$,
                feed,
                item: source_value(item_value),
                articles,
              });
            },
          }),
        ],
      ),
    ],
  );
}

export function FeedCopyButtonView({ vm$, feed }) {
  const status = vm$.methods.copy_status(feed.feed_url);
  const announcement = computed(status, (value) => {
    if (value === "copied") return "RSS 地址已复制";
    if (value === "error") return "复制失败，请重试";
    return "";
  });
  return View({ class: "feed-copy", attributes: { n: "feed-copy" } }, [
    Button(
      {
        class: computed(
          status,
          (value) =>
            "btn feed-copy-button" + (value === "copied" ? " is-copied" : ""),
        ),
        disabled: computed(status, (value) => value === "copying"),
        attributes: {
          n: "feed-copy-button",
          type: "button",
          "aria-label": "复制 " + feed.title + " 的 RSS 地址",
        },
        onClick() {
          vm$.methods.copy_feed_url(feed.feed_url);
        },
      },
      [
        View(
          {
            as: "span",
            class: "feed-copy-icon",
            attributes: { n: "feed-copy-icon", "aria-hidden": "true" },
          },
          [],
        ),
        computed(status, (value) =>
          value === "error" ? "复制失败" : "复制 RSS",
        ),
      ],
    ),
    View(
      {
        class: "feed-copy-status",
        attributes: {
          n: "feed-copy-status",
          role: "status",
          "aria-live": "polite",
        },
      },
      [announcement],
    ),
  ]);
}

function FeedRowView({ vm$, feed }) {
  const feeds_ = vm$.state.feeds;
  const initial =
    String(feed.title || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";
  const type_label_ = computed(vm$.state.platforms, (platforms) =>
    feed.source_type
      ? discovery_platform_label(feed.source_type, platforms)
      : "",
  );
  const type_badge_visible_ = computed(vm$.state.platforms, () =>
    Boolean(feed.source_type),
  );
  // 序号 = 这个源在**当前这批结果**里的下标。不再用 CSS counter：counter 数的是 DOM 顺序，
  // 而 `For` 的占位节点会打断它；序号理应恒等于数据里的下标。
  const rank_ = computed(feeds_, (feeds) =>
    feeds.findIndex((item) => source_value(item).feed_url === feed.feed_url),
  );
  const rank_label_ = computed(rank_, (index) =>
    index < 0 ? "" : String(index + 1).padStart(2, "0"),
  );
  const rank_class_ = computed(
    rank_,
    (index) => "feed-rank" + (index >= 0 && index < 3 ? " feed-rank--top" : ""),
  );
  // 语言 / 标签对一个 feed 是恒定的（`feed` 是 `For` 交进来的普通对象），
  // 所以这一行按普通数组现拼。包成 `Show` 反而会让隐藏分支留下占位节点，
  // `dotted_nodes` 的顿点就会数错位置。
  const meta_entries = compact_nodes([
    feed.language !== ""
      ? View({ class: "feed-language", attributes: { n: "feed-language" } }, [
          feed.language,
        ])
      : "",
    ...feed.tags.map((tag) =>
      Button(
        {
          class: "feed-tag",
          attributes: {
            n: "feed-tag",
            type: "button",
            "aria-pressed": computed(vm$.state.selected_tags, (tags) =>
              String(tags.includes(tag)),
            ),
          },
          onClick() {
            vm$.methods.select_tag(tag);
          },
        },
        [tag],
      ),
    ),
  ]);
  return View({ class: "feed-row", attributes: { n: "feed-row" } }, [
    View(
      {
        class: rank_class_,
        attributes: { n: "feed-rank", "aria-hidden": "true" },
      },
      [rank_label_],
    ),
    LazyAvatar({ src: feed.avatar_url, initial }),
    View({ class: "feed-row-body", attributes: { n: "feed-row-body" } }, [
      View({ class: "feed-head", attributes: { n: "feed-head" } }, [
        View({ class: "feed-identity", attributes: { n: "feed-identity" } }, [
          // 来源类型是识别这个源最重要的信息，从元信息行里单独提到标题上方当标注。
          Show({
            when: type_badge_visible_,
            ok() {
              return View(
                {
                  class: "type-badge type-badge-" + feed.source_type,
                  attributes: { n: "feed-type-badge" },
                },
                [
                  Img({
                    class: "platform-icon",
                    src: computed(vm$.state.platforms, platforms => discovery_platform_icon_url(feed.source_type, platforms)),
                    attributes: {
                      n: "feed-platform-icon",
                      alt: "",
                      "aria-hidden": "true",
                      width: "16",
                      height: "16",
                    },
                  }),
                  type_label_,
                ],
              );
            },
          }),
          View({ class: "feed-title", attributes: { n: "feed-title" } }, [
            feed.title,
          ]),
        ]),
        View({ class: "metrics", attributes: { n: "feed-metrics" } }, [
          Show({
            when: computed(feeds_, () => feed.subscribers > 0),
            ok() {
              return View(
                {
                  class: "metrics-value",
                  attributes: { n: "feed-subscribers" },
                },
                [format_count(feed.subscribers)],
              );
            },
          }),
          Show({
            when: computed(feeds_, () => feed.velocity > 0),
            ok() {
              return View(
                { class: "metrics-value", attributes: { n: "feed-velocity" } },
                [feed.velocity.toFixed(1) + " 篇/周"],
              );
            },
          }),
        ]),
      ]),
      View({ class: "feed-desc", attributes: { n: "feed-desc" } }, [
        feed.description || "暂无介绍",
      ]),
      meta_entries.length === 0
        ? ""
        : View(
            { class: "feed-meta", attributes: { n: "feed-meta" } },
            dotted_nodes(meta_entries),
          ),
      FeedArticlesView({ vm$, feed }),
      View({ class: "feed-actions", attributes: { n: "feed-actions" } }, [
        FeedCopyButtonView({ vm$, feed }),
      ]),
    ]),
  ]);
}

export function PlatformNavigationView({ vm$ }) {
  return View(
    {
      class: "filter-row",
      attributes: {
        n: "platform-filters",
        role: "group",
        "aria-label": "平台单选筛选",
      },
    },
    [
      View(
        { class: "filter-label", attributes: { n: "platform-filter-label" } },
        ["平台"],
      ),
      View(
        {
          class: "filter-options",
          attributes: { n: "platform-filter-options" },
        },
        [
          For({
            key: "id",
            each: vm$.state.platform_filters,
            render(platform_value) {
              const { id, label, icon } = source_value(platform_value);
              return Button(
                {
                  class: computed(
                    vm$.state.selected_platform,
                    (current) =>
                      "filter-chip" + (current === id ? " is-selected" : ""),
                  ),
                  attributes: {
                    n: "platform-filter",
                    type: "button",
                    "aria-pressed": computed(
                      vm$.state.selected_platform,
                      (current) => String(current === id),
                    ),
                  },
                  onClick() {
                    vm$.methods.select_platform(id);
                  },
                },
                [
                  Img({
                    class: "platform-icon",
                    src: platform_icon_url(icon) || platform_icons[id ? discovery_platform_icon(id) : "all"],
                    attributes: {
                      n: "platform-filter-icon",
                      alt: "",
                      "aria-hidden": "true",
                      width: "18",
                      height: "18",
                    },
                  }),
                  label,
                ],
              );
            },
          }),
        ],
      ),
    ],
  );
}

/**
 * 空态 / 加载态：一句衬线大字 + 一条发丝线，不用「暂无数据」的方框。
 * 加载态与空态共用一个骨架，只换文案，于是切换时版面不跳。
 */
function FeedStateView({ title, note }) {
  return View(
    { class: "feed-state", attributes: { n: "feed-state" } },
    compact_nodes([
      View(
        {
          class: "feed-state-rule",
          attributes: { n: "feed-state-rule", "aria-hidden": "true" },
        },
        [],
      ),
      View(
        { class: "feed-state-title", attributes: { n: "feed-state-title" } },
        [title],
      ),
      note
        ? View(
            { class: "feed-state-note", attributes: { n: "feed-state-note" } },
            [note],
          )
        : "",
    ]),
  );
}

export function FeedIndexView({ vm$ }) {
  const empty_visible_ = combine(
    { loading: vm$.state.loading, feeds: vm$.state.feeds },
    (deps) => !deps.loading && deps.feeds.length === 0,
  );
  const empty_title_ = computed(vm$.state.error, (error) =>
    error ? "订阅源没能载入" : "没有找到匹配的订阅源",
  );
  const empty_note_ = computed(
    vm$.state.error,
    (error) => error || "换个关键词，或调整平台和标签筛选",
  );
  const error_visible_ = combine(
    { error: vm$.state.error, feeds: vm$.state.feeds },
    (deps) => deps.error !== "" && deps.feeds.length > 0,
  );
  return View({ class: "feed-index", attributes: { n: "feed-index" } }, [
    Show({
      when: vm$.state.loading,
      ok() {
        return FeedStateView({
          title: "正在检索…",
          note: "稍候，正在查找匹配的订阅源",
        });
      },
    }),
    Show({
      when: empty_visible_,
      ok() {
        return FeedStateView({ title: empty_title_, note: empty_note_ });
      },
    }),
    For({
      key: "feed_url",
      each: computed(vm$.state.feeds, (feeds) => feeds),
      render(feed_value) {
        const feed = source_value(feed_value);
        return FeedRowView({ vm$, feed });
      },
    }),
    Show({
      when: error_visible_,
      ok() {
        return View(
          {
            class: "feed-list-error",
            attributes: { n: "feed-list-error", role: "alert" },
          },
          [vm$.state.error],
        );
      },
    }),
  ]);
}

export function FeedPaginationView({ vm$ }) {
  const state_ = combine(
    {
      page: vm$.state.page,
      total: vm$.state.total_count,
      loading: vm$.state.loading,
    },
    (state) => ({
      ...state,
      pages: Math.max(1, Math.ceil(state.total / SOURCE_PAGE_SIZE)),
    }),
  );
  const button = (name, text, target, disabled) =>
    Button(
      {
        class: "btn pagination-button",
        attributes: {
          n: "feed-pagination-" + name,
          type: "button",
          disabled: computed(
            state_,
            (state) => state.loading || disabled(state) || undefined,
          ),
        },
        onClick() {
          return vm$.methods.select_page(target(state_.value));
        },
      },
      [text],
    );
  return View(
    {
      class: "feed-pagination",
      attributes: {
        n: "feed-pagination",
        role: "navigation",
        "aria-label": "订阅源列表分页",
      },
    },
    [
      View(
        {
          class: "pagination-summary",
          attributes: { n: "feed-pagination-summary", "aria-live": "polite" },
        },
        [
          computed(
            state_,
            (state) =>
              "共 " +
              state.total +
              " 个订阅源 · 第 " +
              (state.page + 1) +
              " / " +
              state.pages +
              " 页",
          ),
        ],
      ),
      View(
        {
          class: "pagination-controls",
          attributes: { n: "feed-pagination-controls" },
        },
        [
          button(
            "first",
            "首页",
            () => 0,
            (state) => state.page === 0,
          ),
          button(
            "prev",
            "上一页",
            (state) => state.page - 1,
            (state) => state.page === 0,
          ),
          button(
            "next",
            "下一页",
            (state) => state.page + 1,
            (state) => state.page >= state.pages - 1,
          ),
          button(
            "last",
            "末页",
            (state) => state.pages - 1,
            (state) => state.page >= state.pages - 1,
          ),
        ],
      ),
    ],
  );
}

export function HomePage({ vm$ }) {
  return View(
    {
      class: "discovery-app",
      attributes: { n: "discovery-app" },
      onMounted() {
        document.querySelector("input")?.focus();
        vm$.methods.init();
      },
    },
    [
      HeaderView(),
      SearchView({ vm$ }),
      View({ class: "shell page-main", attributes: { n: "discovery-main" } }, [
        PlatformNavigationView({ vm$ }),
        TagNavigationView({ vm$ }),
        FeedIndexView({ vm$ }),
        FeedPaginationView({ vm$ }),
      ]),
    ],
  );
}

function read_json(selector) {
  const node = document.querySelector(selector);
  return node ? JSON.parse(node.textContent) : null;
}

function bootstrap() {
  const route = match_discovery_route(window.location.pathname);
  if (!route) {
    throw new Error("订阅广场页面不存在");
  }
  const root = document.getElementById("discovery-root");
  if (!root) {
    throw new Error("FindRSS 订阅广场无法启动：缺少根节点");
  }
  const model = DiscoveryViewModel(read_json('#discovery-catalog, [data-n="discovery-catalog"]'));
  if (root.firstChild) {
    globalThis.Timeless.DOM.hydrate(HomePage({ vm$: model }), root);
  } else {
    globalThis.Timeless.DOM.render(HomePage({ vm$: model }), root);
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
}
