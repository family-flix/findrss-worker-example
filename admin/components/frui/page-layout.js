import { atomic_classes } from "./atomic.js";
import { as_children } from "./shared.js";

const { View } = Timeless;

// PageLayout owns the page gutter and header/content spacing. Business views
// belong in PageContent and do not add another page-sized padding or width cap.
function PageLayout({ header, class: custom_class, attributes = {}, ...rest } = {}, children = []) {
  return View({
    ...rest,
    as: rest.as || "section",
    class: atomic_classes([
      "box-border flex flex-col w-full min-w-0 gap-space-3 m-0 max-640-padding",
      custom_class,
    ].filter(Boolean).join(" ")),
    style: {
      padding: "var(--frui-space-4) var(--frui-space-4) var(--frui-space-6)",
      "--max-640-padding": "var(--frui-space-3) var(--frui-space-3) var(--frui-space-5)",
      ...rest.style,
    },
    attributes: { n: "page-layout", ...attributes },
  }, [...as_children(header), ...as_children(children)].filter(Boolean));
}

function PageContent({ class: custom_class, attributes = {}, ...rest } = {}, children = []) {
  return View({
    ...rest,
    class: atomic_classes([
      "box-border grid w-full min-w-0 min-h-0 align-content-start gap-space-3",
      custom_class,
    ].filter(Boolean).join(" ")),
    attributes: { n: "page-content", ...attributes },
  }, as_children(children).filter(Boolean));
}

export { PageLayout, PageContent };
