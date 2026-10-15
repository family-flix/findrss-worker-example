const { View, For, computed } = Timeless;
import { source_value } from "@/utils.js";

export function AgentDownloads({ items }) {
  return For({ each: items, key: "href", render(raw) {
    const value = field => computed(raw, item => source_value(item)[field]);
    return View({ as: "a", class: "display-block margin-6-pixels-4-pixels padding-8-pixels-10-pixels border-1-pixels-solid-color-border border-radius-8-pixels color-reader-color-link text-decoration-none overflow-wrap-anywhere hover-background-color-surface-raised", attributes: { n: "agent-download", href: value("href"), download: computed(raw, item => source_value(item).kind === "article" ? source_value(item).filename : "") } , style: { ...{"--margin-6-pixels-4-pixels":"6px 4px","--padding-8-pixels-10-pixels":"8px 10px","--border-1-pixels-solid-color-border":"1px solid var(--frui-color-border)","--border-radius-8-pixels":"8px"} }}, [value("label"), " · ", value("filename")]);
  } });
}
