export function ScriptMediaPreviewView(ui, { preview, name = "script-debug" }) {
  const { View, Img, Video, Audio, Show, computed } = ui;
  const src = computed(preview, value => value.src);
  const media = kind => kind === "img"
    ? Img({ src, class: "box-border", style: { "max-width": "100%", "max-height": "60dvh", "object-fit": "contain" },
      attributes: { n: name + "-media-image", alt: "图片预览", referrerpolicy: "no-referrer" } })
    : (kind === "video" ? Video : Audio)({ src, controls: true, preload: "metadata",
      ...(kind === "video" ? { playsInline: true } : {}), class: "box-border w-full",
      style: { "max-height": "60dvh" }, attributes: {
        n: name + "-media-" + kind, "aria-label": kind === "video" ? "视频预览" : "音频预览",
      } });
  return View({ class: "box-border grid gap-space-3 min-w-0", attributes: { n: name + "-media-preview" } }, [
    Show({ when: computed(preview, value => Boolean(value.error)), ok: () => View({
      class: "box-border text-danger break-anywhere", attributes: { n: name + "-media-error", role: "alert" },
    }, [computed(preview, value => value.error)]) }),
    Show({ when: computed(preview, value => !value.src && !value.error), ok: () => View({
      class: "box-border text-muted", attributes: { n: name + "-media-empty", role: "status" },
    }, ["运行调试后查看预览"]) }),
    ...["img", "video", "audio"].map(kind => Show({
      when: computed(preview, value => Boolean(value.src) && value.kind === kind), ok: () => media(kind),
    })),
  ]);
}
