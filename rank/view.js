import { Button, For, Img, Input, Link, Show, View, computed } from "timeless";

function FilterView({ name, label, options, selected, select }) {
  return View({ class: "rank-filter-row", attributes: { n: "rank-" + name + "-filters", role: "group", "aria-label": label + "单选筛选" } }, [
    View({ as: "span", class: "rank-filter-label", attributes: { n: "rank-" + name + "-label" } }, [label]),
    View({ class: "rank-filter-options", attributes: { n: "rank-" + name + "-options" } }, options.map(option =>
      Button({ class: computed(selected, value => "rank-filter-chip" + (value === option.id ? " is-selected" : "")), attributes: {
        n: "rank-" + name + "-filter", type: "button", "aria-pressed": computed(selected, value => String(value === option.id)),
      }, onClick: () => select(option.id) }, [option.label]))),
  ]);
}

function RankCard({ board }) {
  return View({ as: "section", class: "rank-card", attributes: { n: "rank-card", "aria-label": board.title } }, [
    View({ as: "header", class: "rank-card-header", attributes: { n: "rank-card-header" } }, [
      View({ as: "h2", attributes: { n: "rank-card-title" } }, [board.link
        ? Link({ href: board.link, attributes: { n: "rank-source-link", href: board.link, target: "_blank", rel: "noopener noreferrer" } }, [board.title])
        : board.title]),
      View({ as: "span", class: "rank-updated", attributes: { n: "rank-updated" } }, [board.updated]),
    ]),
    board.error
      ? View({ class: "rank-error", attributes: { n: "rank-error", role: "status" } }, [
          View({ as: "p", class: "rank-error-title", attributes: { n: "rank-error-title" } }, ["暂时无法加载"]),
          View({ as: "p", attributes: { n: "rank-error-reason" } }, [board.error]),
        ])
      : View({ as: "ol", class: "rank-entries", attributes: { n: "rank-entries" } }, board.entries.length ? board.entries.map(entry =>
          View({ as: "li", class: "rank-entry", attributes: { n: "rank-entry" } }, [
            View({ as: "span", class: "rank-number", attributes: { n: "rank-number", "aria-label": "排名 " + entry.rank } }, [String(entry.rank)]),
            ...(entry.thumbnail ? [Img({ src: entry.thumbnail, class: "rank-cover", attributes: {
              n: "rank-cover", alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer",
            } })] : []),
            View({ class: "rank-entry-body", attributes: { n: "rank-entry-body" } }, [
              entry.link ? Link({ class: "rank-entry-title", href: entry.link, attributes: {
                n: "rank-entry-link", href: entry.link, target: "_blank", rel: "noopener noreferrer",
              } }, [entry.title]) : View({ as: "span", attributes: { n: "rank-entry-title" } }, [entry.title]),
              ...(entry.heat ? [View({ as: "span", class: "rank-heat", attributes: { n: "rank-heat" } }, [entry.heat])] : []),
            ]),
          ])) : [View({ as: "li", class: "rank-empty", attributes: { n: "rank-empty" } }, ["当前榜单暂无内容"])]),
  ]);
}

export function RankPage({ vm$ }) {
  return View({ class: "rank-shell", attributes: { n: "rank-page" } }, [
    View({ as: "header", class: "rank-masthead", attributes: { n: "rank-masthead" } }, [
      Link({ class: "rank-brand", href: "/", attributes: { n: "rank-brand", href: "/", "aria-label": "FindRSS 订阅广场" } }, [
        Img({ src: "/brand/favicon.svg", attributes: { n: "rank-brand-icon", alt: "", width: "32", height: "32" } }), "FindRSS",
      ]),
      View({ as: "nav", attributes: { n: "rank-navigation", "aria-label": "站点导航" } }, [
        Link({ href: "/", attributes: { n: "rank-discover-link", href: "/" } }, ["订阅广场"]),
        Link({ href: "/rank/", attributes: { n: "rank-home-link", href: "/rank/", "aria-current": "page" } }, ["排行榜"]),
      ]),
    ]),
    View({ class: "rank-heading", attributes: { n: "rank-heading" } }, [
      View({ attributes: { n: "rank-introduction" } }, [
        View({ as: "h1", attributes: { n: "rank-page-title" } }, ["排行榜"]),
        View({ as: "p", class: "rank-summary", attributes: { n: "rank-summary", role: "status" } }, [vm$.state.summary]),
      ]),
      Input({ class: "rank-search", value: vm$.state.query, placeholder: "搜索榜单", attributes: {
        n: "rank-search", type: "search", "aria-label": "搜索榜单", maxlength: "100",
      }, onInput: event => vm$.methods.search(event.target.value) }),
    ]),
    View({ class: "rank-filters", attributes: { n: "rank-filters" } }, [
      FilterView({ name: "category", label: "分类", options: vm$.state.category_filters, selected: vm$.state.selected_category, select: vm$.methods.select_category }),
      FilterView({ name: "source", label: "来源", options: vm$.state.source_filters, selected: vm$.state.selected_source, select: vm$.methods.select_source }),
    ]),
    View({ class: "rank-grid", attributes: { n: "rank-grid" } }, [
      For({ each: vm$.state.boards, render: board => RankCard({ board }) }),
    ]),
    Show({ when: computed(vm$.state.boards, boards => boards.length === 0), ok: () =>
      View({ class: "rank-no-results", attributes: { n: "rank-no-results", role: "status" } }, ["没有找到匹配的榜单"]) }),
  ]);
}
