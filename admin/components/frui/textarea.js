import {
  atomic_classes
} from "./atomic.js";
import {
  frui_host
} from "./platform.js";
const {
  View,
  computed,
  refobj
} = Timeless;
import {
  as_children,
  next_uid
} from "./shared.js";
import {
  InputViewModel
} from "./input.js";
import {
  field_attributes,
  field_autocomplete,
  apply_autocomplete
} from "./field.js";

function Textarea(props = {}) {
  const {
    class: custom_class,
    rootClass,
    rootStyle,
    rootAttributes = {},
    attributes = {},
    value,
    onChange,
    onInput,
    onKeyDown,
    autoSize,
    rows,
    showCount = false,
    label,
    help,
    // 同 Input：长度与 autocomplete 自己落到 DOM，不透传给 Timeless 的 textarea 节点。
    maxLength,
    minLength,
    autoComplete,
    onMounted,
    onUnmounted,
    ...rest
  } = props;
  const model = InputViewModel({
    ...props,
    value,
    onChange,
    onInput,
    onKeyDown,
    attributes
  });
  const state_ = refobj(model.store.state);
  const unlisten = model.store.onStateChange((state) => state_.as(state));
  const textarea_id = attributes.id || next_uid("frui-textarea");
  const label_id = `${textarea_id}-label`;
  const help_id = `${textarea_id}-help`;
  const auto = autoSize === true || (autoSize && typeof autoSize === "object");
  const config = autoSize && typeof autoSize === "object" ? autoSize : {};
  const textarea_attributes = field_attributes(attributes, {
    id: textarea_id
  }, {
    maxLength,
    minLength
  });
  const autocomplete = field_autocomplete(autoComplete, attributes);
  if (label !== undefined) textarea_attributes["aria-labelledby"] = label_id;
  if (help !== undefined) textarea_attributes["aria-describedby"] = help_id;
  if (!auto && rows !== undefined) textarea_attributes.rows = rows;
  let element = null;

  /** autoSize：先归零高度再按 scrollHeight 夹到 [minRows, maxRows] 之间。纯 DOM 计算。 */
  function resize() {
    if (!auto || !element) return;
    const style = frui_host.get_computed_style(element);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 20;
    const chrome = Math.max(0, element.offsetHeight - element.clientHeight);
    const min_rows = Number(config.minRows) > 0 ? Number(config.minRows) : 0;
    const max_rows = Number(config.maxRows) > 0 ? Number(config.maxRows) : 0;
    element.style.minHeight = min_rows > 0 ? `${min_rows * line + chrome}px` : "0";
    element.style.height = "auto";
    const content = element.scrollHeight;
    const max_height = max_rows > 0 ? max_rows * line + chrome : Infinity;
    const next = Math.min(Math.max(content, min_rows > 0 ? min_rows * line + chrome : 0), max_height);
    element.style.height = `${next}px`;
    element.style.overflowY = content > max_height ? "auto" : "hidden";
  }

  const unlisten_resize = auto ? model.store.onChange(() => frui_host.request_frame(resize)) : null;

  const root_node = ui.TextareaPrimitive.Root({
    store: model.store,
    style: rootStyle,
    class: atomic_classes(["flex-1 width-100-percent min-width-0", rootClass].filter(Boolean).join(" ")),
    attributes: {
      n: rootAttributes.n || `${attributes.n || "textarea"}-root`,
      ...rootAttributes
    },
    onUnmounted() {
      unlisten?.();
      unlisten_resize?.();
      model.destroy();
      state_.destroy?.();
      onUnmounted?.();
    },
  }, [ui.TextareaPrimitive.Textarea({
    ...rest,
    store: model.store,
    class: atomic_classes([
      "box-sizing-border-box width-100-percent min-width-0 min-height-control-height border-1-pixels-solid-color-border border-radius-8-pixels padding-0-10-pixels background-color-color-surface color-color-text font-400-font-size-1-4-font-family transition-background-color-motion-fast-border-color-motion-fast-box-shadow-motion-fast placeholder-color-color-placeholder placeholder-opacity-1 aria-invalid-true-frui-control-focus-color-color-danger aria-invalid-true-border-color-color-danger not-disabled-hover-border-color-control-focus-color-color-border-strong focus-border-color-control-focus-color-color-focus focus-visible-border-color-control-focus-color-color-focus focus-outline-none focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent focus-visible-outline-none focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent disabled-cursor-not-allowed disabled-opacity-6 media-forced-colors-active-focus-outline-2-pixels-solid-highlight media-forced-colors-active-focus-outline-offset-2-pixels media-prefers-reduced-motion-reduce-transition-none",
      "placeholder-color-color-placeholder placeholder-opacity-1 font-400-font-size-1-4-font-family",
      "min-height-80-pixels padding-block-space-2 resize-vertical", auto ? "resize-none overflow-hidden" : null, custom_class
    ].filter(Boolean).join(" ")),
    attributes: textarea_attributes,
    onKeyDown(event) {
      model.store.handleKeyDown(event);
    },
    onMounted(event) {
      element = event?.target?.get$elm ? event.target.get$elm() : event?.target ?? null;
      apply_autocomplete(element, autocomplete);
      onMounted?.(event);
      if (auto) frui_host.request_frame(resize);
    },
    style: {
      ...{
        "--border-1-pixels-solid-color-border": "1px solid var(--frui-color-border)",
        "--border-radius-8-pixels": "8px",
        "--padding-0-10-pixels": "0 10px",
        "--focus-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--focus-visible-box-shadow-0-0-0-3-pixels-color-mix-in-srgb-control-focus-color-color-focus-24-percent-transparent": "0 0 0 3px color-mix(in srgb,var(--frui-control-focus-color, var(--frui-color-focus)) 24%,transparent)",
        "--media-forced-colors-active-focus-outline-2-pixels-solid-highlight": "2px solid Highlight",
        "--media-forced-colors-active-focus-outline-offset-2-pixels": "2px",
        "--min-height-80-pixels": "80px"
      },
      ...(rest)?.style
    }
  })]);

  if (label === undefined && help === undefined && !showCount) return root_node;
  return View({
    class: "display-grid gap-space-1 min-width-0",
    attributes: {
      n: `${rootAttributes.n || attributes.n || "textarea"}-field`
    }
  }, [
    label === undefined ? null : View({
      class: "color-color-text font-size-font-size font-weight-600",
      attributes: {
        n: "textarea-label",
        id: label_id
      }
    }, as_children(label)),
    root_node,
    help === undefined ? null : View({
      class: "color-color-muted font-size-font-size-sm font-weight-400 line-height-1-6",
      attributes: {
        n: "textarea-help",
        id: help_id
      }
    }, as_children(help)),
    showCount ?
    View({
      class: "color-color-muted font-size-font-size-sm text-align-right",
      attributes: {
        n: "textarea-count"
      }
    }, [
      computed(state_, (state) => `${String(state.value ?? "").length}/${textarea_attributes.maxlength ?? "∞"}`),
    ]) :
    null,
  ].filter(Boolean));
}

export {
  Textarea
};
