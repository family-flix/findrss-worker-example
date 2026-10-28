import { combine, computed, ref } from "timeless";
import { plain_text } from "../server/lib/discovery_sources.js";
import { public_http_url } from "../server/lib/proxy_url.js";

export function rank_query_state(parameters) {
  const field = (name, limit) => (parameters?.get(name) || "").slice(0, limit).replace(/[\u0000-\u001f\u007f]/g, "");
  return { q: field("q", 100), category: field("category", 32), source_type: field("source_type", 64) };
}

export function RankViewModel(catalog = {}, parameters = null) {
  const initial = rank_query_state(parameters);
  const query = ref(initial.q);
  const selected_category = ref(initial.category);
  const selected_source = ref(initial.source_type);
  const boards = (catalog.boards || []).map(board => ({
    id: String(board.id), title: plain_text(board.title, 160),
    category: plain_text(board.category, 32).trim() || "其他",
    source: plain_text(board.platform?.name, 64).trim() || "其他来源",
    order: Number.isSafeInteger(board.order) ? board.order : 0,
    link: public_http_url(board.link) || "", error: plain_text(board.error, 500),
    updated: Number.isFinite(Date.parse(board.observed_at)) ? new Date(board.observed_at).toISOString().slice(11, 16) + " UTC" : "",
    entries: (board.entries || []).map(entry => {
      const text = String(entry.heat?.text || (entry.heat?.value != null ? entry.heat.value : ""));
      const unit = String(entry.heat?.unit || "");
      return { id: String(entry.id), title: plain_text(entry.title, 300), link: public_http_url(entry.link) || "",
        thumbnail: public_http_url(entry.thumbnail) || "", rank: entry.pinned ? "置顶" : entry.rank ?? "—",
        heat: text ? text + (unit && !text.endsWith(unit) ? " " + unit : "") : "" };
    }),
  })).sort((left, right) => left.order - right.order);
  const visible = combine({ query, selected_category, selected_source }, state => boards.filter(board =>
    board.title.toLowerCase().includes(state.query.trim().toLowerCase())
    && (!state.selected_category || board.category === state.selected_category)
    && (!state.selected_source || board.source === state.selected_source)));
  const options = field => [{ id: "", label: "全部" }, ...[...new Set(boards.map(board => board[field]))].map(value => ({ id: value, label: value }))];

  function sync_location() {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ q: query.value, category: selected_category.value, source_type: selected_source.value })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  return {
    state: {
      query, selected_category, selected_source,
      category_filters: options("category"), source_filters: options("source"), boards: visible,
      summary: computed(visible, rows => `${rows.length} 个榜单，${rows.filter(board => !board.error).length} 个已更新，${rows.filter(board => board.error).length} 个暂不可用`),
    },
    methods: {
      search(value) {
        query.set(String(value).slice(0, 100));
        sync_location();
      },
      select_category(value) { selected_category.set(String(value)); sync_location(); },
      select_source(value) { selected_source.set(String(value)); sync_location(); },
    },
  };
}
