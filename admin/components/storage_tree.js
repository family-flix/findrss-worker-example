const { View, Img, Icon, Button, EmptyCard, CodeEditor, ListViewV2, Show, computed, combine } = window.FindRSSAdminUI;

export function StorageTreeView({ model }) {
  const { state, methods } = model;
  const tree = ListViewV2({
    each: state.rows, key: "id", itemHeight: 40, buffer: 6,
    class: "flex-1 min-w-0 min-h-0 overflow-auto",
    style: { "overflow-anchor": "none" },
    attributes: { n: "storage-tree", role: "tree", tabindex: "0", "aria-label": "R2 文件树",
      "aria-activedescendant": computed(state.active_key, key => key ? "storage-row-" + encodeURIComponent(key) : undefined),
    },
    onClick(event) { event.currentTarget.focus(); },
    onKeyDown(event) {
      const index = methods.keydown(event);
      const element = tree.$elm?.get$elm?.();
      if (index == null || !element) return;
      const top = index * 40;
      if (top < element.scrollTop) element.scrollTop = top;
      if (top + 40 > element.scrollTop + element.clientHeight) element.scrollTop = top + 40 - element.clientHeight;
    },
    render(value) {
      const read = map => computed(value, map);
      return View({
        class: combine({ active: state.active_key, row: value }, ({ active, row }) => "box-border flex items-center gap-space-2 min-w-0 cursor-pointer rounded-control " + (active === row.id ? "bg-selected text-link" : "hover-background-color-surface-hover")),
        style: { height: "40px", "padding-right": "12px", "padding-left": read(row => (12 + row.depth * 18) + "px") },
        attributes: { n: "storage-tree-row", role: "treeitem", id: read(row => "storage-row-" + encodeURIComponent(row.id)),
          title: read(row => row.more ? row.title : row.key), "aria-level": read(row => row.depth + 1),
          "aria-expanded": read(row => row.folder ? String(Boolean(row.expanded)) : undefined),
          "aria-selected": combine({ active: state.active_key, row: value }, ({ active, row }) => String(active === row.id)),
          "aria-busy": read(row => String(Boolean(row.busy))),
        },
        onClick() { void methods.activate(value.value.id); },
      }, [
        View({ class: "flex-none", style: { width: "16px" }, attributes: { n: "storage-tree-caret", "aria-hidden": "true" } }, [
          Show({ when: read(row => row.folder), ok: () => Icon(read(row => row.expanded ? "chevron-down" : "chevron-right"), 14) }),
        ]),
        Icon(read(row => row.more ? "ellipsis" : row.folder ? "folder" : "file"), 16),
        View({ class: "flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm", attributes: { n: "storage-tree-name" } }, [read(row => row.title)]),
        View({ class: "flex-none text-muted text-sm", attributes: { n: "storage-tree-size" } }, [read(row => row.size_label || "")]),
      ]);
    },
  });
  return View({ class: "box-border flex flex-col min-w-0 min-h-0 overflow-hidden rounded-card bg-surface-raised gap-space-2",
    style: { padding: "var(--frui-space-2)" }, attributes: { n: "storage-tree-panel" } }, [
    tree,
    Show({ when: combine({ rows: state.rows, busy: state.busy }, value => !value.busy && !value.rows.length),
      ok: () => View({ class: "text-muted text-sm", attributes: { n: "storage-empty" } }, ["暂无文件"]) }),
  ]);
}

export function StoragePreviewView({ model }) {
  const { state, methods } = model;
  const read = map => computed(state.preview, value => value ? map(value) : "");
  return View({ class: "box-border grid min-w-0 min-h-0 overflow-auto rounded-card bg-surface-raised gap-space-3", style: { padding: "var(--frui-space-4)", "align-content": "start" },
    attributes: { n: "storage-preview", "aria-label": "文件预览", "aria-busy": read(value => String(value.loading)) } }, [
    Show({ when: computed(state.preview, value => !value), ok: () => EmptyCard({
      name: "storage-preview-empty", variant: "inline", size: "medium",
      illustration: "/brand/select-file.svg", title: "请选择文件",
      description: "选择左侧文件，查看文件内容与详情。",
    }) }),
    Show({ when: state.preview, ok: () => View({ class: "grid min-w-0 gap-space-3", attributes: { n: "storage-preview-content" } }, [
      View({ class: "flex items-center justify-between gap-space-2", attributes: { n: "storage-preview-heading" } }, [
        View({ class: "min-w-0 break-anywhere text-sm", attributes: { n: "storage-preview-key" } }, [read(value => value.key)]),
        Button({ size: "small", icon: Icon("x", 16), attributes: { n: "storage-preview-close", "aria-label": "关闭预览" }, onClick: methods.close_preview }, []),
      ]),
      View({ class: "text-muted text-sm", attributes: { n: "storage-preview-details" } }, [read(value => value.size_label + " · 上传于 " + value.uploaded_label)]),
      Show({ when: read(value => value.loading), ok: () => View({ class: "text-muted text-sm", attributes: { n: "storage-preview-loading", role: "status" } }, ["正在读取预览…"]) }),
      View({ class: "text-danger text-sm break-anywhere", attributes: { n: "storage-preview-error", role: "alert" } }, [read(value => value.error)]),
      Show({ when: read(value => !value.error && value.kind === "image"), ok() {
        const key = state.preview.value.key;
        return Img({
          src: read(value => value.src), class: "max-w-full", style: { "max-height": "min(50dvh, 480px)", "object-fit": "contain" },
          attributes: { n: "storage-preview-image", alt: read(value => value.title) }, onError: () => methods.preview_error(key),
        });
      } }),
      Show({ when: read(value => value.kind === "text" && Boolean(value.mode)), ok: () => CodeEditor({
        value: read(value => value.formatted), mode: read(value => value.mode), readOnly: true,
        attributes: { n: "storage-preview-code", "aria-label": "文件文本内容" },
        wrapperStyle: { height: "min(50dvh, 480px)", width: "100%" },
      }) }),
      Show({ when: read(value => value.kind === "text" && !value.mode), ok: () => View({ as: "pre", class: "box-border m-0 min-w-0 overflow-auto whitespace-pre-wrap break-anywhere text-sm",
        style: { "max-height": "min(50dvh, 480px)", "font-family": "ui-monospace, monospace" },
        attributes: { n: "storage-preview-text", tabindex: "0", "aria-label": "文件文本内容" } }, [read(value => value.text)]) }),
      Show({ when: read(value => value.truncated), ok: () => View({ class: "text-muted text-sm", attributes: { n: "storage-preview-truncated", role: "status" } }, ["文件较大，仅预览前 1 MiB 内容。"]) }),
      Show({ when: read(value => value.kind === "unsupported"), ok: () => View({ class: "text-muted text-sm", attributes: { n: "storage-preview-unsupported" } }, ["此文件类型暂不支持预览"]) }),
    ]) }),
  ]);
}
