export function ScriptMediaPreviewView(ui, { preview }) {
  const { View, Img, Show, computed } = ui;
  const src = computed(preview, value => value.src);
  const media = kind => kind === "img"
    ? Img({ src, class: "box-border", style: { "max-width": "100%", "max-height": "60dvh", "object-fit": "contain" },
      attributes: { n: "script-debug-media-image", alt: "图片预览", referrerpolicy: "no-referrer" } })
    : View({ as: kind === "video" ? "video" : "audio", class: "box-border w-full",
      style: { "max-height": "60dvh" }, attributes: {
        n: "script-debug-media-" + kind, src, controls: "", preload: "metadata",
        ...(kind === "video" ? { playsinline: "" } : {}), "aria-label": kind === "video" ? "视频预览" : "音频预览",
      } });
  return View({ class: "box-border grid gap-space-3 min-w-0", attributes: { n: "script-debug-media-preview" } }, [
    Show({ when: computed(preview, value => Boolean(value.error)), ok: () => View({
      class: "box-border text-danger break-anywhere", attributes: { n: "script-debug-media-error", role: "alert" },
    }, [computed(preview, value => value.error)]) }),
    Show({ when: computed(preview, value => !value.src && !value.error), ok: () => View({
      class: "box-border text-muted", attributes: { n: "script-debug-media-empty", role: "status" },
    }, ["运行调试后查看预览"]) }),
    ...["img", "video", "audio"].map(kind => Show({
      when: computed(preview, value => Boolean(value.src) && value.kind === kind), ok: () => media(kind),
    })),
  ]);
}
