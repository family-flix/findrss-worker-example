// Shared pagination state. Lists filter first, then use the resulting total.
export function PaginationModel(ui, { total, loading, page, page_size, on_change } = {}) {
  const { ref, combine } = ui;
  page = page || ref(0);
  page_size = page_size || ref(20);
  loading = loading || ref(false);
  const state = combine({ total, page, page_size, loading }, values => {
    const count = Math.max(0, Number(values.total) || 0);
    const size = values.page_size;
    const pages = Math.max(1, Math.ceil(count / size));
    const current = Math.min(pages - 1, Math.max(0, values.page));
    return { total: count, page: current, page_size: size, pages, loading: values.loading,
      first: count ? current * size + 1 : 0, last: Math.min(count, (current + 1) * size) };
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
    class: "box-border flex-none justify-self-center", attributes: { n: name + "-" + suffix, type: "button" },
    disabled: read(state => state.loading || disabled(state)),
    onClick() { return model.set_page(target(model.state.value)); },
  }, [text]);
  return View({ class: "box-border flex flex-wrap-nowrap min-w-0 overflow-x-auto items-center justify-between text-muted tabular-nums", style: {
    "gap": ".75rem",
    "margin-top": "1rem",
    "padding-block": ".75rem",
    "border-top": "1px solid var(--frui-color-border-soft)",
    "font-size": ".75rem"
  }, attributes: { n: name, role: "navigation", "aria-label": label } }, [
    View({class: "box-border flex-none whitespace-nowrap",  attributes: { n: name + "-summary", "aria-live": "polite" } }, [
      read(state => "共 " + state.total + " 条 · 显示 " + state.first + "–" + state.last),
    ]),
    View({ class: "box-border flex flex-none flex-wrap-nowrap items-center", style: {
      "gap": ".5rem"
    }, attributes: { n: name + "-pages" } }, [
      button("first", "首页", () => 0, state => state.page === 0),
      button("prev", "上一页", state => state.page - 1, state => state.page === 0),
      View({ class: "box-border whitespace-nowrap", attributes: { n: name + "-position" } }, [
        read(state => "第 " + (state.page + 1) + " / " + state.pages + " 页"),
      ]),
      button("next", "下一页", state => state.page + 1, state => state.page === state.pages - 1),
      button("last", "末页", state => state.pages - 1, state => state.page === state.pages - 1),
    ]),
    View({ class: "box-border flex flex-none flex-wrap-nowrap items-center whitespace-nowrap", style: {
      "gap": ".5rem"
    }, attributes: { n: name + "-size-control" } }, [
      View({class: "box-border flex-none whitespace-nowrap",  attributes: { n: name + "-size-label" } }, ["每页"]),
      Select({class: "box-border", style: { width: "5rem", "min-width": "5rem" }, value: computed(model.page_size, String), options: [10, 20, 50].map(size => ({ value: String(size), label: size + " 条" })),
        disabled: read(state => state.loading),
        attributes: { n: name + "-size", "aria-label": label + "每页条数" },
        onChange(event) { return model.set_page_size(event.target.value); } }),
    ]),
  ]);
}
