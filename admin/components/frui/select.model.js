const {
  computed,
  ref
} = Timeless;
import {
  source_value,
  subscribe_source,
  dispose_all
} from "./shared.js";

function SelectViewModel({
  value,
  defaultValue = null,
  options = [],
  disabled,
  placeholder = "请选择",
  onChange
} = {}) {
  const store = new vm.SelectCore({
    position: "popper",
    defaultValue: source_value(value, defaultValue),
    placeholder
  });
  // SelectCore.hide 即使已关闭也启动退出动画；保存禁用、重复关闭都不能挂载下拉项。
  const hide = store.hide.bind(store);
  store.hide = () => {
    if (store.open) hide();
  };
  const state = ref(store.state),
    items = ref([]);
  const entries = new Map();
  let syncing = false;
  const publish = () => {
    if (!syncing) state.set(store.state);
  };

  function sync_options(rows = source_value(options, []), selected = source_value(value, store.value)) {
    syncing = true;
    try {
      const next = rows.map(row => {
        let entry = entries.get(row.value);
        if (!entry) {
          const item = new vm.SelectItemCore(row);
          entry = {
            item,
            detach: item.onStateChange(publish)
          };
          entries.set(row.value, entry);
        }
        entry.item.setLabel(row.label);
        entry.item.disabled = Boolean(row.disabled);
        return entry.item;
      });
      for (const [key, entry] of entries) {
        if (next.includes(entry.item)) continue;
        entry.detach();
        entries.delete(key);
      }
      store.options = store.raw_options = next;
      store.value = selected;
      store.selected_item$ = next.find(item => item.value === selected) || null;
      store.focused_item$ = null;
      for (const item of next) {
        item.setSelected(item === store.selected_item$);
        item.setFocused(false);
      }
      items.set(next);
    } finally {
      syncing = false;
    }
    publish();
  }

  function set_disabled(next) {
    store.disabled = Boolean(next);
    if (store.disabled) store.hide();
    publish();
  }
  const unlistens = [
    store.onStateChange(publish),
    store.onChange(next => {
      if (syncing) return;
      try {
        return onChange?.(next);
      } finally {
        if (value !== undefined) sync_options();
      }
    }),
    subscribe_source(options, rows => sync_options(rows)),
    subscribe_source(value, next => sync_options(undefined, next)),
    subscribe_source(disabled, set_disabled),
  ];
  sync_options();
  set_disabled(source_value(disabled, false));
  const is_placeholder = computed(state, next => !next.selectedOption && (next.value == null || next.value === ""));
  const label = computed(state, next => next.selectedOption?.label ?? (next.value == null || next.value === "" ? next.placeholder : next
    .value));
  const focused = computed(state, () => store.options.find(item => item.focused)?.value);
  return {
    store,
    state,
    items,
    label,
    focused,
    is_placeholder,
    select(item) {
      if (!store.disabled && !item.disabled) store.handleClickItem(item);
    },
    handle_key(event) {
      if (store.disabled || event.isComposing) return;
      const key = event.key;
      if (!["ArrowDown", "ArrowUp", "Enter", " ", "Escape", "Tab"].includes(key)) return;
      if (key === "Tab") {
        store.hide();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (key === "Escape") {
        store.hide();
        store.focus();
        return;
      }
      if (!store.open) {
        store.show();
        return;
      }
      if (key === "ArrowDown") store.focusNextOption();
      else if (key === "ArrowUp") store.focusPrevOption();
      else {
        store.selectFocusedOption();
        store.focus();
      }
    },
    destroy() {
      dispose_all(unlistens);
      for (const entry of entries.values()) entry.detach();
      entries.clear();
      store.destroy();
      state.destroy?.();
      items.destroy?.();
      label.destroy?.();
      focused.destroy?.();
      is_placeholder.destroy?.();
    },
  };
}

export {
  SelectViewModel
};
