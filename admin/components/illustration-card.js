import { atomic_classes } from "./frui/atomic.js";
const { View, Img } = Timeless;

const illustration_sizes = { small: [160, 108], medium: [280, 188], large: [360, 240] };

export function illustration_dimensions(size = "medium") {
  const [width, height] = illustration_sizes[size] || illustration_sizes.medium;
  return { width, height };
}

export function IllustrationCard({ name = "illustration-card", illustration, title, description, actions = [], variant = "page", size = variant === "inline" ? "small" : "medium" }) {
  const { width, height } = illustration_dimensions(size);
  return View({ class: atomic_classes(`display-flex flex-direction-column align-items-center justify-content-center gap-space-3 padding-space-4 text-align-center min-width-0${variant}`), attributes: { n: name },
    style: { "--reader-empty-illustration-width": `${width}px`, "--reader-empty-illustration-height": `${height}px` },
  }, [
    Img({
      class: "width-reader-empty-illustration-width max-width-100-percent height-auto",
      src: illustration,
      attributes: { n: `${name}-illustration`, alt: "", "aria-hidden": "true", width: String(width), height: String(height), loading: "lazy", decoding: "async" },
    }),
    View({ as: "h2", class: "margin-0 font-size-font-size-lg", attributes: { n: `${name}-title` } }, [title]),
    View({ as: "p", class: "margin-0 color-color-muted overflow-wrap-anywhere", attributes: { n: `${name}-description` } }, [description]),
    ...(actions.length ? [View({ class: "display-flex flex-wrap-wrap gap-space-2", attributes: { n: `${name}-actions` } }, actions)] : []),
  ]);
}

export function EmptyCard({ name = "empty-card", illustration = "/illustrations/xiaoxun-empty-watermark.webp", title = "暂无内容", description = "这里暂时还没有内容。", actions = [], variant = "page", size } = {}) {
  return IllustrationCard({ name, illustration, title, description, actions, variant, size });
}
