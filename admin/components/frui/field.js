import {
  atomic_classes
} from "./atomic.js";
const {
  View,
  Show,
  ref,
  computed
} = Timeless;
import {
  Tooltip
} from "./tooltip.js";
import {
  normalize_autocomplete,
  as_children,
  next_uid,
  dispose_all
} from "./shared.js";

function FieldViewModel({
  store,
  label,
  help,
  error
} = {}) {
  const state = ref(store?.state || {});
  const unlistens = [
    store?.onStateChange(value => state.set(value)),
    store?.onError(value => state.set({
      ...state.value,
      error: value
    })),
  ];
  return {
    state: {
      label: label === undefined ? computed(state, value => value.label || "") : label,
      help: help === undefined ? computed(state, value => value.help || "") : help,
      error: error === undefined ? computed(state, value => value.error?.message || "") : error,
    },
    destroy() {
      dispose_all(unlistens);
      state.destroy?.();
    },
  };
}

function Field({
  store,
  label,
  tooltip,
  help,
  error,
  id,
  control_id,
  layout,
  class: custom_class,
  attributes = {},
  controlProps = {},
  messageProps = {},
  onMounted,
  onUnmounted,
  ...rest
} = {}, children = []) {
  if (layout !== undefined && !["vertical", "horizontal"].includes(layout)) throw new RangeError("Field layout 必须为 vertical 或 horizontal");
  const model = FieldViewModel({
    store,
    label,
    help,
    error
  });
  const state = model.state;
  const field_id = id || next_uid("frui-field");
  const name = attributes.n || `field-${store?.name || field_id}`;
  const has_error = computed(state.error, Boolean);
  let detach_control;
  return View({
    ...rest,
    class: atomic_classes([
      "display-grid gap-space-1 min-width-0 gap-space-2 data-layout-horizontal-grid-template-columns-max-content-minmax-0-1fr data-layout-horizontal-align-items-start media-max-width-720-pixels-grid-template-columns-minmax-0-1fr",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: name,
      "data-layout": layout,
      "data-invalid": computed(has_error, String),
      ...attributes
    },
    onMounted(event) {
      const node = event.target?.get$elm?.() || event.target;
      const control = node?.querySelector?.('[role="combobox"]') || node?.querySelector?.(
        'input, textarea, select, [role="checkbox"], [role="textbox"]');
      if (control) {
        if (!control.id) control.id = `${field_id}-input`;
        const label = node.querySelector("label");
        if (label) label.htmlFor = control.id;
        const described_by = control.getAttribute("aria-describedby") || "";
        const apply = () => {
          control.setAttribute("aria-labelledby", `${field_id}-label`);
          control.setAttribute("aria-invalid", String(has_error.value));
          control.setAttribute("aria-describedby", [described_by, `${field_id}-message`].filter(Boolean).join(" "));
        };
        apply();
        detach_control = has_error.subscribe({
          onChange: apply
        });
      }
      return onMounted?.(event);
    },
    onUnmounted() {
      detach_control?.();
      model.destroy();
      onUnmounted?.();
    },
  }, [
    View({
      class: atomic_classes(["display-flex align-items-center gap-space-1 min-width-0", layout === "horizontal" ?
        "padding-block-start-space-2" : ""
      ].join(" ")),
      attributes: {
        n: `${name}-label-row`
      }
    }, [
      View({
        as: "label",
        class: atomic_classes(computed(has_error, value => "color-color-text font-size-font-size font-weight-600 " + (value ?
          "color-color-danger" : ""))),
        attributes: {
          n: `${name}-label`,
          id: `${field_id}-label`,
          for: control_id || `${field_id}-input`
        }
      }, as_children(state.label)),
      tooltip === undefined ? null : Tooltip({
        as: "button",
        content: tooltip,
        class: "flex-none border-0 padding-space-1 background-transparent color-color-muted cursor-help focus-visible-outline-2-pixels-solid-color-focus focus-visible-outline-offset-2-pixels focus-visible-border-radius-radius-sm",
        attributes: {
          n: `${name}-tooltip`,
          type: "button",
          "aria-label": computed(state.label, value => `${value}说明`)
        },
        style: {
          ...{
            "--focus-visible-outline-2-pixels-solid-color-focus": "2px solid var(--frui-color-focus)",
            "--focus-visible-outline-offset-2-pixels": "2px"
          }
        }
      }, [Timeless.Icon({
        name: "circle-help",
        size: 14
      })]),
    ].filter(Boolean)),
    View({
      ...controlProps,
      class: atomic_classes(["display-grid gap-space-1 min-width-0", controlProps.class].filter(Boolean).join(" ")),
      attributes: {
        n: `${name}-control`
      }
    }, [
      ...as_children(children),
      View({
        ...messageProps,
        attributes: {
          n: `${name}-message`,
          id: `${field_id}-message`
        }
      }, [
        Show({
          when: has_error,
          ok: () => View({
            class: "color-color-muted font-size-font-size-sm font-weight-400 line-height-1-6 color-color-danger cursor-text user-select-text webkit-user-select-text",
            attributes: {
              n: `${name}-error`,
              role: "alert"
            }
          }, as_children(state.error)),
          else: () => View({
            class: "color-color-muted font-size-font-size-sm font-weight-400 line-height-1-6",
            attributes: {
              n: `${name}-help`
            }
          }, as_children(state.help)),
        }),
      ]),
    ]),
  ]);
}

function field_attributes(attributes, extra, fields = {}) {
  const merged = {
    n: attributes.n || "input",
    ...attributes,
    ...extra
  };
  delete merged.autocomplete;
  const {
    maxLength,
    minLength,
    type
  } = fields;
  if (maxLength !== undefined && Number(maxLength) > 0) merged.maxlength = Number(maxLength);
  if (minLength !== undefined && Number(minLength) > 0) merged.minlength = Number(minLength);
  if (type !== undefined) merged.type = type;
  return merged;
}

function field_autocomplete(autoComplete, attributes) {
  return normalize_autocomplete(attributes.autocomplete !== undefined ? attributes.autocomplete : autoComplete);
}

function apply_autocomplete(element, value) {
  if (!element || typeof element.setAttribute !== "function") return;
  if (value === undefined) element.removeAttribute("autocomplete");
  else element.setAttribute("autocomplete", value);
}

export {
  Field,
  FieldViewModel,
  field_attributes,
  field_autocomplete,
  apply_autocomplete
};
