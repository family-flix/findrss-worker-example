import {
  atomic_classes
} from "./atomic.js";
const {
  View
} = Timeless;

function Badge(props = {}, children = []) {
  const {
    tone = "neutral",
      variant = "soft",
      count,
      max = 99,
      dot = false,
      class: custom_class,
      attributes = {},
      ...rest
  } = props;
  const numeric = count !== undefined && count !== null;
  const classes = [
    "display-inline-flex align-items-center min-height-24-pixels border-0 border-radius-radius-pill padding-0-space-2 background-badge-bg-color-surface-raised color-badge-color-color-muted font-600-11-pixels-1-font-family",
    `${{"neutral":"frui-badge-color-color-muted frui-badge-bg-color-surface-raised","brand":"frui-badge-color-color-link frui-badge-bg-color-selected","success":"frui-badge-color-color-success frui-badge-bg-color-success-bg","warning":"frui-badge-color-color-warning frui-badge-bg-color-warning-bg","danger":"frui-badge-color-color-danger frui-badge-bg-color-danger-bg"}[tone] || ""}`,
    variant !== "soft" ?
    `${{"danger":"frui-badge-color-color-danger frui-badge-bg-color-danger-bg","solid":"background-badge-color-color-surface-raised color-color-canvas","outline":"background-transparent"}[variant] || ""}` :
    "", tone === "brand" && variant === "solid" ? "background-color-primary color-color-on-primary" : "", dot ?
    "width-8-pixels height-8-pixels min-height-8-pixels border-0 padding-0 background-badge-color-color-primary" : numeric ?
    "justify-content-center min-width-20-pixels padding-0-6-pixels" : "", custom_class
  ];
  const shown = dot ?
    [] :
    numeric ?
    [Number(count) > Number(max) ? `${max}+` : String(count)] :
    children;
  return View({
    ...rest,
    class: atomic_classes(classes.filter(Boolean).join(" ")),
    attributes: {
      n: attributes.n || "badge",
      ...attributes
    },
    style: {
      ...{
        "--min-height-24-pixels": "24px",
        "--font-600-11-pixels-1-font-family": "600 11px/1 var(--frui-font-family)",
        "--width-8-pixels": "8px",
        "--height-8-pixels": "8px",
        "--min-height-8-pixels": "8px",
        "--min-width-20-pixels": "20px",
        "--padding-0-6-pixels": "0 6px"
      },
      ...(rest)?.style
    }
  }, shown);
}

export {
  Badge,
  Badge as FRBadge
};
