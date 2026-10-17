const {
  computed
} = Timeless;

// Component defaults precede caller overrides, including reactive variants.
const property_pattern =
  /^(.*?)(webkit-box-decoration-break|border-bottom-right-radius|frui-control-focus-color|frui-loading-dot-size|grid-template-columns|font-variant-numeric|box-decoration-break|padding-block-start|webkit-user-select|overscroll-behavior|background-position|frui-button-height|border-block-start|grid-template-rows|webkit-box-orient|webkit-line-clamp|padding-inline-end|frui-loading-size|padding-block-end|border-inline-end|background-repeat|inset-inline-end|background-color|frui-badge-color|border-top-color|transform-origin|margin-block-end|background-image|border-block-end|backdrop-filter|inset-block-end|justify-content|text-decoration|animation-delay|background-size|flex-direction|pointer-events|text-transform|outline-offset|padding-inline|vertical-align|padding-bottom|align-content|overflow-wrap|justify-items|border-radius|text-overflow|frui-badge-bg|padding-block|margin-bottom|padding-right|border-bottom|margin-inline|border-color|justify-self|webkit-mask|touch-action|aspect-ratio|margin-block|margin-right|border-right|align-items|grid-column|flex-shrink|font-family|line-height|place-items|user-select|white-space|inline-size|font-weight|margin-left|padding-top|border-left|align-self|background|box-shadow|box-sizing|max-height|min-height|margin-top|object-fit|overflow-y|text-align|block-size|transition|border-top|appearance|visibility|list-style|overflow-x|flex-basis|flex-wrap|font-size|max-width|min-width|transform|animation|isolation|position|overflow|grid-row|display|outline|padding|opacity|z-index|content|border|cursor|height|margin|resize|bottom|inset|right|color|width|flex|font|left|mask|gap|top)(?:-|$)/;
const shorthand_groups = {
  display: /^(?:block|contents|flex|grid|hidden|inline-flex|inline-grid|inline-block)$/,
  position: /^(?:absolute|fixed|relative|sticky)$/,
  background: /^bg-/,
  "box-sizing": /^(?:box-border|box-sizing-border-box)$/,
  "border-radius": /^rounded-/,
  "font-family": /^font-(?:ui|mono|monospace)$/,
  "font-size": /^text-(?:base|sm)$/,
  font: /^font-inherit$/,
  color: /^text-(?:danger|inherit|link|muted|success|text|warning)$/,
  "text-align": /^text-(?:left|center|right)$/,
  "text-overflow": /^text-ellipsis$/,
  "white-space": /^whitespace-/,
  "align-items": /^items-/,
  "justify-content": /^justify-(?:between|center|end|start)$/,
  "flex-direction": /^flex-(?:col|row)$/,
  "flex-shrink": /^flex-shrink-/,
  "font-variant-numeric": /^tabular-nums$/,
  "overflow-wrap": /^break-anywhere$/,
  "text-decoration": /^no-underline$/,
  "object-fit": /^object-cover$/,
  height: /^h-/,
  width: /^w-/,
  "min-height": /^min-h-/,
  "min-width": /^min-w-/,
  "max-height": /^max-h-/,
  "max-width": /^max-w-/,
  margin: /^m-/,
  "margin-top": /^mt-/,
  padding: /^p-/,
  "line-height": /^leading-/,
  "grid-column": /^col-span-/,
  "animation-duration": /^animation-duration(?:-|$)/,
  animation: /^animate-/,
};

export function atomic_class_group(name) {
  const prefix = name.match(
    /^(?:media-max-width-\d+-|max-\d+-|media-prefers-reduced-motion-reduce-|media-forced-colors-active-|motion-reduce-)/)?.[0] || "";
  const utility = name.slice(prefix.length);
  for (const [property, pattern] of Object.entries(shorthand_groups)) {
    if (prefix && property === "display" && utility === "flex") continue;
    if (pattern.test(utility)) return prefix + property;
  }
  const match = utility.match(property_pattern);
  return match ? prefix + match[1] + (match[2] === "background-color" ? "background" : match[2]) : name;
}

export function atomic_classes(value) {
  if (value?.__is_ref) return computed(value, atomic_classes);
  const seen = new Set();
  return String(value || "").trim().split(/\s+/).filter(Boolean).reverse().filter(name => {
    const group = atomic_class_group(name);
    if (seen.has(group)) return false;
    seen.add(group);
    return true;
  }).reverse().join(" ");
}
