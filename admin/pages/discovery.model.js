import { PaginationModel } from "../components/pagination.js";
import { PollPolicyModel } from "../components/poll_policy.model.js";
import {
  discovery_platforms,
  discovery_platform_id,
} from "../components/discovery_platform.js";
import { RssRoutePatternModel } from "../../server/domain/rss_route.js";

const Timeless = window.FindRSSAdminUI;
const fetch = window.FindRSSAdminAuth.fetch;
const { combine, computed, ref, refarr } = Timeless;

const legacy_category_tags = {
  technology: "科技",
  development: "开发",
  business: "商业",
  science: "科学",
  design: "设计",
  life: "生活",
};

const feed_host_token = "{{hostname}}";

const feed_host_placeholder = "https://template.invalid";

function is_template_feed_url(value) {
  return String(value || "").startsWith(feed_host_token);
}

function is_managed_rss_url(value) {
  const text = String(value || "");
  const candidate = is_template_feed_url(text)
    ? feed_host_placeholder + text.slice(feed_host_token.length)
    : text;
  try {
    const url = new URL(candidate);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.pathname.startsWith("/rss/") || url.pathname.startsWith("/atom/"))
    );
  } catch {
    return false;
  }
}

/**
 * 自有 RSS/Atom 地址按匹配的脚本路由预填平台，其余归为网页。
 */
function infer_source_route(feed_url, scripts) {
  const text = String(feed_url || "");
  const candidate = is_template_feed_url(text)
    ? feed_host_placeholder + text.slice(feed_host_token.length)
    : text;
  let pathname;
  try {
    pathname = new URL(candidate).pathname;
  } catch {
    return null;
  }
  const match = /^\/(?:rss|atom)(\/.*)$/.exec(pathname);
  if (!match) return null;
  return scripts
    .filter((script) => script.status !== "draft")
    .flatMap((script) => script.routes || [script])
    .find((entry) =>
      RssRoutePatternModel.fromValue(entry.path)?.match(match[1]),
    );
}

function infer_source_type(feed_url, scripts) {
  return discovery_platform_id(infer_source_route(feed_url, scripts)?.platform);
}

function infer_source_tags(feed_url, scripts) {
  return infer_source_route(feed_url, scripts)?.tags || [];
}

/** @param {unknown} value 头像只接受站内相对路径（服务端给的就是 `/api/avatar/<id>?v=`）。*/
function safe_avatar_url(value) {
  if (typeof value !== "string") return "";
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.length > 2048)
    return "";
  return path;
}

function normalize_source(source) {
  return {
    id: String(source.id || ""),
    title: String(source.title || ""),
    description: String(source.description || ""),
    website: String(source.website || ""),
    feed_url: String(source.feed_url || ""),
    // 服务端已把 {{hostname}} 展开成当前环境的绝对地址；这里留着存储原文供编辑回填。
    feed_url_template: String(source.feed_url_template || ""),
    tags: [
      ...new Set(
        [
          ...(Array.isArray(source.tags) ? source.tags.map(String) : []),
          legacy_category_tags[source.category],
        ].filter(Boolean),
      ),
    ],
    enabled: source.enabled === true,
    require_token: source.require_token === true,
    sort_order: Number(source.sort_order || 0),
    source_type: String(source.source_type || "website"),
    poll_policy: source.poll_policy || { mode: "inherit" },
    poll_effective: source.poll_effective || null,
    next_snapshot_at: source.next_snapshot_at ?? null,
    avatar_url: safe_avatar_url(source.avatar_url),
    created_at: Number(source.created_at || 0),
    updated_at: Number(source.updated_at || 0),
    cache: source.cache || null,
    snapshot: source.snapshot || { saved_at: 0, articles: [], error: "" },
  };
}

async function request_json(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败：HTTP " + response.status);
  }
  return payload;
}

function DiscoveryAdminViewModel() {
  const poll_editor = PollPolicyModel({ ui: Timeless });
  const sources_ = refarr([]);
  const platforms_ = ref(discovery_platforms());
  const tags_ = ref([]);
  const snapshot_refreshing_ = ref([]);
  const snapshot_errors_ = ref(new Map());
  const scripts_ = ref([]);
  const scripts_error_ = ref("");
  const scripts_loading_ = ref(false);
  const query_ = ref("");
  const filter_platform_ = ref("all");
  const filter_status_ = ref("enabled");
  const draft_title_ = ref("");
  const draft_feed_url_ = ref("");
  const draft_website_ = ref("");
  const draft_description_ = ref("");
  const draft_tags_ = ref("");
  const draft_sort_order_ = ref("0");
  const draft_enabled_ = ref(true);
  const draft_require_token_ = ref(false);
  const draft_source_type_ = ref("website");
  // 手改过「平台」之后就不再按地址自动预判（否则用户的选择会被下一次输入覆盖）。
  const source_type_touched_ = ref(false);
  const tags_touched_ = ref(false);
  const avatar_file_ = ref(null);
  // 记住 file input 的 DOM 节点：上传成功后要把它的 value 清空，否则同一个文件选不了第二次。
  let avatar_input_node = null;
  const editing_id_ = ref("");
  const form_open_ = ref(false);
  const loading_ = ref(false);
  const saving_ = ref(false);
  const previewing_ = ref(false);
  const preview_avatar_ = ref("");
  let preview_generation = 0;
  let preview_id = "";
  const list_error_ = ref("");
  const form_error_ = ref("");
  const form_message_ = ref("");
  const import_open_ = ref(false);
  const import_text_ = ref("");
  const import_error_ = ref("");
  const import_message_ = ref("");
  const import_busy_ = ref(false);
  const import_reading_ = ref(false);
  let import_generation = 0;

  const state = {
    sources: sources_,
    platforms: platforms_,
    tags: tags_,
    platform_options: computed(platforms_, (platforms) =>
      platforms.map((type) => ({ value: type.id, label: type.label })),
    ),
    filter_platform_options: computed(platforms_, (platforms) => [
      { value: "all", label: "全部平台" },
      ...platforms.map((type) => ({ value: type.id, label: type.label })),
    ]),
    snapshot_refreshing: snapshot_refreshing_,
    snapshot_errors: snapshot_errors_,
    scripts: scripts_,
    scripts_error: scripts_error_,
    scripts_loading: scripts_loading_,
    query: query_,
    filter_platform: filter_platform_,
    filter_status: filter_status_,
    draft_title: draft_title_,
    draft_feed_url: draft_feed_url_,
    draft_website: draft_website_,
    draft_description: draft_description_,
    draft_tags: draft_tags_,
    draft_sort_order: draft_sort_order_,
    draft_enabled: draft_enabled_,
    draft_require_token: draft_require_token_,
    draft_source_type: draft_source_type_,
    avatar_file: avatar_file_,
    editing_id: editing_id_,
    form_open: form_open_,
    loading: loading_,
    saving: saving_,
    previewing: previewing_,
    preview_avatar: preview_avatar_,
    list_error: list_error_,
    form_error: form_error_,
    form_message: form_message_,
    import_open: import_open_,
    import_text: import_text_,
    import_error: import_error_,
    import_message: import_message_,
    import_busy: import_busy_,
    import_reading: import_reading_,
  };

  let list_generation = 0;
  async function load() {
    const current = ++list_generation;
    loading_.set(true);
    list_error_.set("");
    try {
      const payload = await request_json("/admin/api/discovery/sources");
      if (current === list_generation) {
        tags_.set(Array.isArray(payload.tags) ? [...new Set(payload.tags.filter(tag => typeof tag === "string"))] : []);
        sources_.as(
          (Array.isArray(payload.sources) ? payload.sources : []).map(
            normalize_source,
          ),
        );
        platforms_.set(
          Array.isArray(payload.platforms)
            ? payload.platforms.map(({ id, name, label, icon }) => ({
                id,
                label: name || label,
                ...(icon === undefined ? {} : { icon }),
              }))
            : discovery_platforms(),
        );
      }
    } catch (error) {
      if (current === list_generation)
        list_error_.set(error instanceof Error ? error.message : String(error));
    } finally {
      if (current === list_generation) loading_.set(false);
    }
  }

  async function load_scripts() {
    if (scripts_loading_.value) return;
    scripts_loading_.set(true);
    scripts_error_.set("");
    try {
      const payload = await request_json("/admin/api/scripts?kind=rss");
      scripts_.set(Array.isArray(payload.scripts) ? payload.scripts : []);
      if (editing_id_.value === "" && !tags_touched_.value)
        draft_tags_.set(infer_source_tags(draft_feed_url_.value, scripts_.value).join(", "));
      if (editing_id_.value === "" && !source_type_touched_.value)
        draft_source_type_.set(
          infer_source_type(draft_feed_url_.value, scripts_.value),
        );
    } catch (error) {
      scripts_error_.set(
        "脚本路由提示加载失败：" +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      scripts_loading_.set(false);
    }
  }

  function draft_payload() {
    const sort_order = Number(draft_sort_order_.value);
    return {
      title: draft_title_.value.trim(),
      feed_url: draft_feed_url_.value.trim(),
      website: draft_website_.value.trim(),
      description: draft_description_.value.trim(),
      category: "",
      tags: draft_tags_.value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ""),
      enabled: draft_enabled_.value === true,
      require_token: draft_require_token_.value === true,
      sort_order: Number.isInteger(sort_order) ? sort_order : 0,
      source_type: draft_source_type_.value || "website",
      poll_policy: poll_editor.methods.value(),
    };
  }

  /** 列表项按 id 就地替换（保存/上传/移除头像都回权威 `{source}`）。 */
  function apply_source(source) {
    sources_.as(
      sources_.value.map((item) => (item.id === source.id ? source : item)),
    );
  }

  /**
   * 头像上传不能走 `request_json`：它会给任何带 body 的请求硬塞
   * `Content-Type: application/json`（见其实现）。直接把 `File` 交给 fetch，
   * 浏览器会带上正确的 Content-Type 与 Content-Length。
   */
  async function put_avatar(source_id, file) {
    const response = await fetch(
      "/admin/api/discovery/sources/" +
        encodeURIComponent(source_id) +
        "/avatar",
      {
        method: "PUT",
        body: file,
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "头像上传失败：HTTP " + response.status);
    }
    return normalize_source(payload.source);
  }

  function clear_avatar_file() {
    avatar_file_.set(null);
    if (avatar_input_node) avatar_input_node.value = "";
  }

  async function save_source() {
    if (saving_.value || previewing_.value) return;
    saving_.set(true);
    form_error_.set("");
    form_message_.set("");
    const was_editing = editing_id_.value;
    const pending_avatar = avatar_file_.value;
    try {
      const payload = draft_payload();
      const result = await request_json(
        was_editing === ""
          ? "/admin/api/discovery/sources"
          : "/admin/api/discovery/sources/" + encodeURIComponent(was_editing),
        {
          method: was_editing === "" ? "POST" : "PATCH",
          ...(was_editing === "" && preview_id ? { headers: { "X-Feed-Preview-ID": preview_id } } : {}),
          body: JSON.stringify(payload),
        },
      );
      let source = normalize_source(result.source);
      sources_.as(
        was_editing === ""
          ? [source, ...sources_.value]
          : sources_.value.map((item) =>
              item.id === source.id ? source : item,
            ),
      );
      if (was_editing === "") pagination.reset();
      if (pending_avatar) {
        // 源本身已经存下来了：头像失败只提示，不回滚（否则用户丢掉刚填的其它字段）。
        try {
          source = await put_avatar(source.id, pending_avatar);
          apply_source(source);
        } catch (error) {
          editing_id_.set(source.id);
          form_error_.set(
            source.title +
              " 已保存，但头像上传失败：" +
              (error instanceof Error ? error.message : String(error)),
          );
          return;
        }
      }
      methods.reset_draft();
      saving_.set(false);
      form_open_.set(false);
      form_message_.set(source.title + " 已保存。");
    } catch (error) {
      form_error_.set(error instanceof Error ? error.message : String(error));
    } finally {
      saving_.set(false);
    }
  }

  const methods = {
    open_import() {
      if (loading_.value || saving_.value || import_busy_.value) return;
      import_generation++;
      import_text_.set("");
      import_error_.set("");
      import_message_.set("");
      import_open_.set(true);
    },
    close_import() {
      if (import_busy_.value) return;
      import_generation++;
      import_open_.set(false);
      import_text_.set("");
      import_reading_.set(false);
    },
    set_import_text(text) {
      if (import_busy_.value || import_reading_.value) return;
      import_text_.set(text);
      import_error_.set("");
      import_message_.set("");
    },
    async read_import_file(files) {
      const file = files?.[0];
      if (!file || import_busy_.value || import_reading_.value) return;
      import_error_.set("");
      import_message_.set("");
      if (!/\.json$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
        import_error_.set("请选择不超过 2 MB 的 JSON 文件");
        return;
      }
      const generation = ++import_generation;
      import_reading_.set(true);
      try {
        const text = await file.text();
        if (generation === import_generation)
          import_text_.set(text.replace(/^\uFEFF/, ""));
      } catch (error) {
        if (generation === import_generation)
          import_error_.set("读取失败：" + (error.message || String(error)));
      } finally {
        if (generation === import_generation) import_reading_.set(false);
      }
    },
    async import_sources() {
      if (import_busy_.value || import_reading_.value || loading_.value) return;
      import_error_.set("");
      import_message_.set("");
      let sources;
      try {
        if (import_text_.value.length > 2 * 1024 * 1024)
          throw new Error("JSON 内容过大");
        const parsed = JSON.parse(import_text_.value.replace(/^\uFEFF/, ""));
        sources = Array.isArray(parsed) ? parsed : parsed?.sources;
        if (
          !Array.isArray(sources) ||
          !sources.length ||
          sources.length > 1000
        ) {
          throw new Error(
            '请提供包含 1–1000 个订阅源的数组或 { "sources": [...] }',
          );
        }
        sources = sources.map((source, index) => {
          if (
            !source ||
            typeof source !== "object" ||
            Array.isArray(source) ||
            typeof source.title !== "string" ||
            !source.title.trim() ||
            typeof source.feed_url !== "string" ||
            !source.feed_url.trim()
          ) {
            throw new Error(
              "第 " + (index + 1) + " 项必须包含 title 和 feed_url 字符串",
            );
          }
          return Object.fromEntries(
            [
              "title",
              "description",
              "website",
              "feed_url",
              "category",
              "tags",
              "enabled",
              "require_token",
              "sort_order",
              "source_type",
              "poll_policy",
            ]
              .filter((key) => source[key] !== undefined)
              .map((key) => [
                key,
                key === "feed_url"
                  ? (typeof source.feed_url_template === "string" &&
                    source.feed_url_template
                      ? source.feed_url_template
                      : source.feed_url
                    ).trim()
                  : source[key],
              ]),
          );
        });
      } catch (error) {
        import_error_.set("JSON 格式错误：" + (error.message || String(error)));
        return;
      }
      import_busy_.set(true);
      const existing = new Set(
        sources_.value
          .flatMap((source) => [source.feed_url, source.feed_url_template])
          .filter(Boolean),
      );
      let imported = 0,
        skipped = 0,
        processed = 0;
      try {
        for (const source of sources) {
          if (existing.has(source.feed_url)) skipped++;
          else {
            const result = await request_json("/admin/api/discovery/sources", {
              method: "POST",
              body: JSON.stringify(source),
            });
            const saved = normalize_source(result.source);
            sources_.as([saved, ...sources_.value]);
            existing.add(source.feed_url);
            imported++;
          }
          processed++;
          import_message_.set(
            "已导入 " + imported + " 个，跳过重复地址 " + skipped + " 个。",
          );
        }
        import_text_.set("");
      } catch (error) {
        import_error_.set(
          "第 " +
            (processed + 1) +
            " 项导入失败：" +
            (error.message || String(error)) +
            "。已保存的订阅源保留，可重试剩余内容。",
        );
        import_text_.set(
          JSON.stringify({ sources: sources.slice(processed) }, null, 2),
        );
      } finally {
        pagination.reset();
        import_busy_.set(false);
      }
    },
    export_sources() {
      if (loading_.value || !sources_.value.length) return;
      list_error_.set("");
      let object_url = "";
      try {
        const sources = sources_.value.map(
          ({
            cache,
            snapshot,
            feed_url_template,
            poll_effective,
            next_snapshot_at,
            ...source
          }) => ({
            ...source,
            feed_url: feed_url_template || source.feed_url,
          }),
        );
        const blob = new Blob([JSON.stringify({ sources }, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        object_url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.setAttribute("data-n", "discovery-source-export-download");
        anchor.href = object_url;
        anchor.download =
          "findrss-sources-" + new Date().toISOString().slice(0, 10) + ".json";
        anchor.click();
      } catch (error) {
        list_error_.set("导出失败：" + (error.message || "无法下载 JSON 文件"));
      } finally {
        if (object_url)
          window.setTimeout(() => URL.revokeObjectURL(object_url), 1000);
      }
    },
    async copy_url(url) {
      list_error_.set("");
      try {
        await window.navigator.clipboard.writeText(url);
      } catch (error) {
        list_error_.set("复制失败，请检查浏览器剪贴板权限后重试。");
        throw error;
      }
    },
    refresh_list() {
      return load();
    },
    async refresh_snapshot(source_id) {
      const source = sources_.value.find((item) => item.id === source_id);
      if (
        !source ||
        (source.require_token && !source.cache) ||
        snapshot_refreshing_.value.includes(source_id)
      )
        return;
      snapshot_refreshing_.set([...snapshot_refreshing_.value, source_id]);
      snapshot_errors_.set(new Map(snapshot_errors_.value).set(source_id, ""));
      try {
        const result = await request_json(
          "/admin/api/discovery/sources/" +
            encodeURIComponent(source_id) +
            "/snapshot",
          { method: "POST" },
        );
        sources_.as(
          sources_.value.map((item) =>
            item.id === source_id
              ? {
                  ...item,
                  snapshot: result.snapshot,
                  cache: result.cache || item.cache,
                  ...(result.next_snapshot_at === undefined
                    ? {}
                    : { next_snapshot_at: result.next_snapshot_at }),
                  ...(result.poll_effective
                    ? { poll_effective: result.poll_effective }
                    : {}),
                }
              : item,
          ),
        );
        snapshot_errors_.set(
          new Map(snapshot_errors_.value).set(
            source_id,
            result.snapshot.error || "",
          ),
        );
      } catch (error) {
        snapshot_errors_.set(
          new Map(snapshot_errors_.value).set(
            source_id,
            error.message || "快照更新失败",
          ),
        );
      } finally {
        snapshot_refreshing_.set(
          snapshot_refreshing_.value.filter((id) => id !== source_id),
        );
      }
    },
    create_source() {
      if (saving_.value) return;
      methods.reset_draft();
      form_open_.set(true);
      load_scripts();
    },
    close_form() {
      if (saving_.value) return;
      form_open_.set(false);
      methods.reset_draft();
    },
    async preview_feed() {
      const address = draft_feed_url_.value.trim();
      if (saving_.value || previewing_.value || !address) return;
      if (
        is_template_feed_url(address) &&
        (!/^\{\{hostname\}\}\/(rss|atom)\//.test(address) ||
          !is_managed_rss_url(address))
      ) {
        form_message_.set("");
        form_error_.set(
          "模板订阅源地址必须以 {{hostname}}/rss/ 或 {{hostname}}/atom/ 开头",
        );
        return;
      }
      const generation = ++preview_generation;
      const fields = {
        title: draft_title_,
        website: draft_website_,
        description: draft_description_,
        tags: draft_tags_,
        source_type: draft_source_type_,
      };
      const before = Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [key, field.value]),
      );
      previewing_.set(true);
      preview_id = "";
      form_error_.set("");
      form_message_.set("正在读取订阅源…");
      try {
        const result = await request_json("/admin/api/discovery/preview", {
          method: "POST",
          body: JSON.stringify({ feed_url: address, cache_snapshot: editing_id_.value === "" }),
        });
        if (generation !== preview_generation) return;
        preview_id = result.preview_id || "";
        for (const [key, field] of Object.entries(fields)) {
          if (
            field.value !== before[key] ||
            (key === "tags" && tags_touched_.value) ||
            (key === "source_type" &&
              (source_type_touched_.value || editing_id_.value !== ""))
          )
            continue;
          if (key === "source_type" && is_managed_rss_url(address)) {
            field.set(infer_source_type(address, scripts_.value));
            continue;
          }
          if (key === "tags" && infer_source_route(address, scripts_.value)) {
            field.set(infer_source_tags(address, scripts_.value).join(", "));
            continue;
          }
          field.set(
            key === "tags"
              ? result.defaults.tags.join(", ")
              : result.defaults[key],
          );
        }
        preview_avatar_.set("");
        if (result.avatar && !avatar_file_.value) {
          const bytes = Uint8Array.from(atob(result.avatar.data), (char) =>
            char.charCodeAt(0),
          );
          avatar_file_.set(
            new File([bytes], "feed-avatar", {
              type: result.avatar.content_type,
            }),
          );
          preview_avatar_.set(
            "data:" +
              result.avatar.content_type +
              ";base64," +
              result.avatar.data,
          );
        }
        form_message_.set(
          "已从 " +
            result.feed_url +
            " 填入默认值，可修改后保存。" +
            (result.avatar_error ? "头像未读取：" + result.avatar_error : ""),
        );
      } catch (error) {
        if (generation === preview_generation) {
          form_message_.set("");
          form_error_.set(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (generation === preview_generation) previewing_.set(false);
      }
    },
    start() {
      load();
    },
    set_filter(name, value) {
      pagination.reset();
      if (name === "query") query_.set(String(value));
      if (name === "platform") filter_platform_.set(String(value));
      if (name === "status") filter_status_.set(String(value));
    },
    set_draft(name, value) {
      if (name === "title") draft_title_.set(String(value));
      if (name === "feed_url") {
        preview_id = "";
        preview_generation++;
        previewing_.set(false);
        if (preview_avatar_.value) clear_avatar_file();
        preview_avatar_.set("");
        draft_feed_url_.set(String(value));
        if (editing_id_.value === "" && !tags_touched_.value)
          draft_tags_.set(infer_source_tags(String(value), scripts_.value).join(", "));
        // 只有「新增」且用户没手改过平台时才自动预判；编辑已有源时不覆盖已保存的选择。
        if (editing_id_.value === "" && !source_type_touched_.value) {
          draft_source_type_.set(
            infer_source_type(String(value), scripts_.value),
          );
        }
      }
      if (name === "website") draft_website_.set(String(value));
      if (name === "description") draft_description_.set(String(value));
      if (name === "tags") {
        tags_touched_.set(true);
        draft_tags_.set(String(value));
      }
      if (name === "sort_order") draft_sort_order_.set(String(value));
      if (name === "require_token") draft_require_token_.set(value === true);
      if (name === "source_type") {
        source_type_touched_.set(true);
        draft_source_type_.set(String(value));
      }
    },
    toggle_tag(tag) {
      if (!tags_.value.includes(tag)) return;
      const selected = draft_tags_.value.split(",").map(value => value.trim()).filter(Boolean);
      methods.set_draft("tags", [...new Set(selected.includes(tag)
        ? selected.filter(value => value !== tag) : [...selected, tag])].join(", "));
    },
    set_avatar_file(file, input_node) {
      preview_avatar_.set("");
      if (input_node) avatar_input_node = input_node;
      avatar_file_.set(file instanceof File ? file : null);
      form_error_.set("");
      form_message_.set("");
    },
    edit_source(source_id) {
      if (saving_.value) return;
      const source = sources_.value.find((item) => item.id === source_id);
      if (!source) return;
      preview_id = "";
      preview_generation++;
      previewing_.set(false);
      preview_avatar_.set("");
      editing_id_.set(source.id);
      draft_title_.set(source.title);
      draft_feed_url_.set(source.feed_url_template || source.feed_url);
      draft_website_.set(source.website);
      draft_description_.set(source.description);
      draft_tags_.set(source.tags.join(", "));
      draft_sort_order_.set(String(source.sort_order));
      draft_enabled_.set(source.enabled);
      draft_require_token_.set(source.require_token);
      draft_source_type_.set(source.source_type || "website");
      poll_editor.methods.reset(source.poll_policy);
      source_type_touched_.set(false);
      tags_touched_.set(false);
      clear_avatar_file();
      form_error_.set("");
      form_message_.set("");
      form_open_.set(true);
      load_scripts();
    },
    reset_draft() {
      preview_id = "";
      preview_generation++;
      previewing_.set(false);
      preview_avatar_.set("");
      editing_id_.set("");
      draft_title_.set("");
      draft_feed_url_.set("");
      draft_website_.set("");
      draft_description_.set("");
      draft_tags_.set("");
      tags_touched_.set(false);
      draft_sort_order_.set("0");
      draft_enabled_.set(true);
      draft_require_token_.set(false);
      draft_source_type_.set("website");
      poll_editor.methods.reset();
      source_type_touched_.set(false);
      clear_avatar_file();
      form_error_.set("");
      form_message_.set("");
    },
    async remove_avatar() {
      const source_id = editing_id_.value;
      if (source_id === "") return;
      form_error_.set("");
      form_message_.set("");
      try {
        const result = await request_json(
          "/admin/api/discovery/sources/" +
            encodeURIComponent(source_id) +
            "/avatar",
          { method: "DELETE" },
        );
        const source = normalize_source(result.source);
        apply_source(source);
        clear_avatar_file();
        form_message_.set(source.title + " 的头像已移除。");
      } catch (error) {
        form_error_.set(error instanceof Error ? error.message : String(error));
      }
    },
    save_source() {
      return save_source();
    },
    async toggle_source(source_id) {
      const source = sources_.value.find((item) => item.id === source_id);
      if (!source) return;
      try {
        const result = await request_json(
          "/admin/api/discovery/sources/" + encodeURIComponent(source_id),
          {
            method: "PATCH",
            body: JSON.stringify({ enabled: !source.enabled }),
          },
        );
        const updated = normalize_source(result.source);
        sources_.as(
          sources_.value.map((item) =>
            item.id === updated.id ? updated : item,
          ),
        );
        form_message_.set(
          updated.title + (updated.enabled ? " 已启用。" : " 已停用。"),
        );
      } catch (error) {
        list_error_.set(error instanceof Error ? error.message : String(error));
      }
    },
    async remove_source(source_id) {
      const source = sources_.value.find((item) => item.id === source_id);
      if (!source) return;
      if (!window.confirm("删除订阅源“" + source.title + "”？此操作无法撤销。"))
        return;
      try {
        await request_json(
          "/admin/api/discovery/sources/" + encodeURIComponent(source_id),
          {
            method: "DELETE",
          },
        );
        sources_.as(sources_.value.filter((item) => item.id !== source_id));
        if (editing_id_.value === source_id) methods.reset_draft();
        form_message_.set(source.title + " 已删除。");
      } catch (error) {
        list_error_.set(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const visible_sources = combine(
    {
      sources: sources_,
      query: query_,
      platform: filter_platform_,
      status: filter_status_,
    },
    (deps) => {
      const query = deps.query.trim().toLowerCase();
      return deps.sources.filter((source) => {
        if (deps.platform !== "all" && source.source_type !== deps.platform)
          return false;
        if (deps.status === "enabled" && !source.enabled) return false;
        if (deps.status === "disabled" && source.enabled) return false;
        if (query === "") return true;
        return [
          source.title,
          source.description,
          source.website,
          source.feed_url,
          source.feed_url_template,
          source.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
    },
  );

  const pagination = PaginationModel(Timeless, {
    total: computed(visible_sources, (sources) => sources.length),
    loading: loading_,
  });
  const paged_sources = combine(
    { sources: visible_sources, pagination: pagination.state },
    ({ sources, pagination: page }) =>
      sources.slice(
        page.page * page.page_size,
        (page.page + 1) * page.page_size,
      ),
  );

  // 编辑态下用于回显当前头像（`?v=` 带版本号，换图后地址会变）。
  const editing_source = computed(
    editing_id_,
    (source_id) => sources_.value.find((item) => item.id === source_id) || null,
  );

  return {
    state,
    methods,
    poll_editor,
    visible_sources,
    paged_sources,
    pagination,
    editing_source,
  };
}

export {
  normalize_source,
  is_template_feed_url,
  is_managed_rss_url,
  DiscoveryAdminViewModel,
};
