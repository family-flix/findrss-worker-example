// Shared pagination state. Lists filter first, then use the resulting total.
// ListCore 负责服务端分页；PaginationModel 仅将其状态适配到现有分页控件。
export function ListPaginationModel(ui, { url, key, normalize = value => value, loading, error,
  filters = () => ({}), on_data, visible_count, fetch = window.FindRSSAdminAuth.fetch } = {}) {
  const { kit, Result } = ui;
  const page = ui.ref(0), page_size = ui.ref(20), total = ui.ref(0);
  loading = loading || ui.ref(false);
  error = error || ui.ref("");
  const client = new kit.HttpClientCore({});
  client.fetch = async options => {
    const response = await fetch(options.url, { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败：HTTP " + response.status);
    return { ok: response.ok, status: response.status, data };
  };
  const request = new kit.RequestCore(({ page, pageSize, next_marker, ...query }) => ({
    url, method: "GET", query: { limit: pageSize, offset: (page - 1) * pageSize, ...query },
  }), { client, delay: null, process(result) {
    if (result.error) return result;
    const payload = result.data;
    const params = request.args[0];
    return Result.Ok({ list: (payload[key] || []).map(normalize), total: Number(payload.total_count) || 0,
      page: params.page, pageSize: params.pageSize, payload });
  } });
  const list = new kit.ListCore(request, { pageSize: 20,
    processor(response, original) { return { ...response, payload: original.payload }; } });
  let generation = 0, active = null;
  function load(target_page = page.value, { background = false } = {}) {
    const current = ++generation;
    const params = { ...filters(), page: target_page + 1, pageSize: page_size.value };
    if (!background) loading.set(true);
    error.set("");
    async function run() {
      if (current !== generation) return;
      try {
        const result = await list.search(params);
        if (current !== generation) return;
        if (result.error) throw result.error;
        const response = list.response;
        const last_page = Math.max(0, Math.ceil(response.total / params.pageSize) - 1);
        if (target_page > last_page) {
          // 已在串行请求内部，直接重新读取有效页，避免等待自己。
          params.page = last_page + 1;
          target_page = last_page;
          const retry = await list.search(params);
          if (current !== generation) return;
          if (retry.error) throw retry.error;
        }
        page.set(target_page);
        total.set(list.response.total);
        await on_data?.(list.response.dataSource, list.response.payload);
      } catch (failure) {
        if (current === generation) error.set(failure.message || String(failure));
      } finally {
        if (current === generation) loading.set(false);
      }
    }
    // ListCore 的参数属于实例，串行执行并跳过旧查询，防止旧响应覆盖新筛选。
    const task = active ? active.then(run) : run();
    active = task;
    task.finally(() => { if (active === task) active = null; });
    return task;
  }
  const pagination = PaginationModel(ui, { total, page, page_size, loading, visible_count, on_change: load });
  return { ...pagination, list, total, load, error,
    destroy() { generation++; list.destroy(); request.destroy(); client.destroy(); } };
}

export function PaginationModel(ui, { total, loading, page, page_size, visible_count, on_change } = {}) {
  const { ref, combine } = ui;
  page = page || ref(0);
  page_size = page_size || ref(20);
  loading = loading || ref(false);
  const state = combine({ total, page, page_size, loading, ...(visible_count ? { visible_count } : {}) }, values => {
    const count = Math.max(0, Number(values.total) || 0);
    const size = values.page_size;
    const pages = Math.max(1, Math.ceil(count / size));
    const current = Math.min(pages - 1, Math.max(0, values.page));
    const shown = values.visible_count ?? size;
    return { total: count, page: current, page_size: size, pages, loading: values.loading,
      first: count && shown ? current * size + 1 : 0, last: shown ? Math.min(count, current * size + shown) : 0 };
  });
  function set_page(value) {
    if (loading.value) return;
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    const next = Math.max(0, Math.min(state.value.pages - 1, Math.floor(number)));
    if (next === state.value.page) return;
    if (on_change) return on_change(next);
    page.set(next);
  }
  function set_page_size(value) {
    if (loading.value) return;
    const size = Number(value);
    if (![10, 20, 50].includes(size) || size === page_size.value) return;
    page_size.set(size);
    page.set(0);
    if (on_change) return on_change(0);
  }
  return { page, page_size, state, set_page, set_page_size, reset() { page.set(0); } };
}

export function PaginationView(ui, { model, name, label }) {
  const { View, Button, Select, computed } = ui;
  const read = map => computed(model.state, map);
  const button = (suffix, text, target, disabled) => Button({
    icon: false,
    class: "box-border flex-none justify-self-center", attributes: { n: name + "-" + suffix, type: "button" },
    disabled: read(state => state.loading || disabled(state)),
    onClick() { return model.set_page(target(model.state.value)); },
  }, [text]);
  return View({ class: "box-border flex flex-wrap min-w-0 items-center justify-between text-muted tabular-nums", style: {
    "gap": ".75rem",
    "margin-top": "1rem",
    "padding-block": ".75rem",
    "border-top": "1px solid var(--frui-color-border-soft)"
  }, attributes: { n: name, role: "navigation", "aria-label": label } }, [
    View({class: "box-border flex-none whitespace-nowrap",  attributes: { n: name + "-summary", "aria-live": "polite" } }, [
      read(state => "共 " + state.total + " 条 · 显示 " + state.first + "–" + state.last),
    ]),
    View({ class: "box-border flex flex-wrap min-w-0 max-w-full items-center justify-end gap-space-3", style: {
      "margin-inline-start": "auto"
    }, attributes: { n: name + "-controls" } }, [
      View({ class: "box-border flex flex-wrap min-w-0 items-center justify-end gap-space-2",
        attributes: { n: name + "-pages" } }, [
        button("first", "首页", () => 0, state => state.page === 0),
        button("prev", "上一页", state => state.page - 1, state => state.page === 0),
        View({ class: "box-border flex-none whitespace-nowrap", attributes: { n: name + "-position" } }, [
          read(state => "第 " + (state.page + 1) + " / " + state.pages + " 页"),
        ]),
        button("next", "下一页", state => state.page + 1, state => state.page === state.pages - 1),
        button("last", "末页", state => state.pages - 1, state => state.page === state.pages - 1),
      ]),
      View({ class: "box-border flex flex-none items-center whitespace-nowrap gap-space-2",
        attributes: { n: name + "-size-control" } }, [
        View({class: "box-border flex-none whitespace-nowrap",  attributes: { n: name + "-size-label" } }, ["每页"]),
        Select({class: "box-border", style: { width: "7rem", "min-width": "7rem", flex: "none" }, value: computed(model.page_size, String), options: [10, 20, 50].map(size => ({ value: String(size), label: size + " 条" })),
          disabled: read(state => state.loading),
          attributes: { n: name + "-size", "aria-label": label + "每页条数" },
          onChange(event) { return model.set_page_size(event.target.value); } }),
      ]),
    ]),
  ]);
}
