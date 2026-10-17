import { atomic_classes } from "./frui/atomic.js";
const { View, Img } = Timeless;

const illustration_sizes = { small: [160, 108], medium: [280, 188], large: [360, 240] };

export function illustration_dimensions(size = "medium") {
  const [width, height] = illustration_sizes[size] || illustration_sizes.medium;
  return { width, height };
}

export function IllustrationCard({ name = "illustration-card", illustration, title, description, actions = [], variant = "page", size = variant === "inline" ? "small" : "medium" }) {
  const { width, height } = illustration_dimensions(size);
  const inline = variant === "inline";
  return View({ class: atomic_classes("box-border flex w-full flex-col items-center justify-center gap-space-3 text-center min-w-0 " + (inline ? "" : "rounded-card bg-surface")), attributes: { n: name },
    style: {
      "--reader-empty-illustration-width": `${width}px`,
      "--reader-empty-illustration-height": `${height}px`,
      padding: inline ? "var(--frui-space-4)" : "var(--frui-space-6)",
      ...(inline ? {} : { "min-height": "360px", border: "1px solid var(--frui-color-border-soft)" }),
    },
  }, [
    Img({
      class: "width-reader-empty-illustration-width max-width-100-percent height-auto",
      src: illustration,
      attributes: { n: `${name}-illustration`, alt: "", "aria-hidden": "true", width: String(width), height: String(height), loading: "lazy", decoding: "async" },
    }),
    View({ as: "h2", class: "m-0 text-text font-size-font-size-lg font-weight-600", attributes: { n: `${name}-title` } }, [title]),
    View({ as: "p", class: "m-0 text-muted text-base break-anywhere", style: { "max-width": "36ch", "line-height": "1.6" }, attributes: { n: `${name}-description` } }, [description]),
    ...(actions.length ? [View({ class: "flex flex-wrap justify-center gap-space-2", style: { "margin-top": "var(--frui-space-1)" }, attributes: { n: `${name}-actions` } }, actions)] : []),
  ]);
}

export function EmptyCard({ name = "empty-card", variant = "page", illustration = variant === "inline" ? "/brand/watermark.svg" : "/brand/empty.svg", title = "暂无内容", description = "这里暂时还没有内容。", actions = [], size } = {}) {
  return IllustrationCard({ name, illustration, title, description, actions, variant, size });
}
