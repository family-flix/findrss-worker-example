import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  computed,
  refobj
} = Timeless;
import {
  source_value,
  subscribe_source,
  dispose_all,
  next_uid,
  as_children
} from "./shared.js";

function FilePickerViewModel(props = {}) {
  const store = new vm.FilePickerCore({
    accept: props.accept,
    multiple: props.multiple === true
  });
  const state = refobj(store.state);

  function sync() {
    store.disabled = Boolean(source_value(props.disabled, false));
    store.loading = Boolean(source_value(props.loading, false));
    if (store.disabled || store.loading) store.dragging = false;
    state.as(store.state);
  }
  sync();
  const unlistens = [
    store.onStateChange(value => state.as(value)),
    store.onReject(() => state.as(store.state)),
    store.onChange(files => props.onChange?.(files)),
    subscribe_source(props.disabled, sync),
    subscribe_source(props.loading, sync),
  ];
  return {
    store,
    state,
    methods: {
      choose(files) {
        if (store.disabled || store.loading || !files?.length) return;
        store.handleDrop({
          files: Array.from(files).slice(0, store.multiple ? undefined : 1)
        });
      },
      drag_over(items) {
        if (!store.disabled && !store.loading) store.handleDragOver({
          files: items
        });
      },
      drag_leave() {
        store.handleDragLeave();
      },
    },
    destroy() {
      dispose_all(unlistens);
      state.destroy?.();
      store.destroy?.();
    }
  };
}

function FilePicker({
  accept = "",
  multiple = false,
  disabled,
  loading,
  onChange,
  tip = "点击选择文件，或将文件拖到这里",
  class: custom_class,
  attributes = {},
  onUnmounted
} = {}, children) {
  const model = FilePickerViewModel({
    accept,
    multiple,
    disabled,
    loading,
    onChange
  });
  const state = model.state;
  const name = attributes.n || "file-picker";
  const id = next_uid("frui-file-picker");
  const blocked = computed(state, value => value.disabled || value.loading);
  const error = computed(state, value => value.invalid_files.length ? `不支持的文件类型，仅支持 ${accept}` : "");
  let input_element;
  return ui.FilePickerPrimitive.Root({
    store: model.store,
    class: atomic_classes(["min-width-0", custom_class].filter(Boolean).join(" ")),
    attributes: {
      n: `${name}-root`
    },
    onUnmounted() {
      model.destroy();
      input_element = null;
      onUnmounted?.();
    },
  }, [
    ui.FilePickerPrimitive.Input({
      store: model.store,
      accept,
      multiple,
      disabled: blocked,
      attributes: {
        n: name,
        type: "file",
        hidden: true,
        "aria-label": attributes["aria-label"] || "选择文件"
      },
      onMounted(event) {
        input_element = event.target?.get$elm?.() || event.target;
      },
      onChange(event) {
        model.methods.choose(event.target.files);
        event.target.value = "";
      },
    }),
    View({
      as: "button",
      class: atomic_classes(computed(state, value => [
        "not-disabled-focus-visible-border-color-control-focus-color-color-focus focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight media-forced-colors-active-focus-visible-outline-offset-2-pixels display-flex flex-direction-column align-items-center justify-content-center gap-6-pixels width-100-percent padding-24-pixels-12-pixels border-1-pixels-dashed-color-border border-radius-radius-control background-color-surface color-color-text font-inherit font-size-14-pixels hover-background-color-selected disabled-opacity-5",
        value.dragging ? "background-color-selected" : "", value.invalid || value.invalid_files.length ?
        "background-color-danger-bg" : ""
      ].filter(Boolean).join(" "))),
      attributes: {
        ...attributes,
        n: `${name}-dropzone`,
        type: "button",
        disabled: computed(blocked, value => value || undefined),
        "aria-label": attributes["aria-label"] || tip,
        "aria-describedby": children === undefined ? `${id}-hint ${id}-error` : `${id}-error`,
        "aria-invalid": computed(error, value => value ? "true" : undefined),
        "aria-busy": computed(state, value => String(value.loading))
      },
      onClick() {
        if (!blocked.value) input_element?.click();
      },
      onDragOver(event) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = blocked.value ? "none" : "copy";
        model.methods.drag_over(event.dataTransfer?.items);
      },
      onDragLeave(event) {
        if (!event.currentTarget?.contains(event.relatedTarget)) model.methods.drag_leave();
      },
      onDrop(event) {
        event.preventDefault();
        model.methods.drag_leave();
        model.methods.choose(event.dataTransfer?.files);
      },
      style: {
        ...{
          "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
          "--media-forced-colors-active-focus-visible-outline-2-pixels-solid-highlight": "2px solid Highlight",
          "--media-forced-colors-active-focus-visible-outline-offset-2-pixels": "2px",
          "--gap-6-pixels": "6px",
          "--padding-24-pixels-12-pixels": "24px 12px",
          "--border-1-pixels-dashed-color-border": "1px dashed var(--frui-color-border)",
          "--font-size-14-pixels": "14px"
        }
      }
    }, children === undefined ? [
      View({
        class: "max-width-100-percent overflow-wrap-anywhere",
        attributes: {
          n: `${name}-label`,
          "aria-live": "polite"
        }
      }, [
        computed(state, value => value.loading ? "正在处理文件…" : value.value?.length ? value.value.map(file => file.name).join("、") :
          tip),
      ]),
      View({
        class: "color-color-muted font-size-12-pixels",
        attributes: {
          n: `${name}-hint`,
          id: `${id}-hint`
        },
        style: {
          ...{
            "--font-size-12-pixels": "12px"
          }
        }
      }, [accept]),
    ] : as_children(children)),
    View({
      class: "color-color-danger font-size-12-pixels not-empty-margin-top-6-pixels",
      attributes: {
        n: `${name}-error`,
        id: `${id}-error`,
        role: "alert"
      },
      style: {
        ...{
          "--font-size-12-pixels": "12px",
          "--not-empty-margin-top-6-pixels": "6px"
        }
      }
    }, [error]),
  ]);
}

export {
  FilePicker,
  FilePickerViewModel
};
