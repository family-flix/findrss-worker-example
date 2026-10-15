import {
  atomic_classes
} from "./atomic.js";
const {
  Img,
  Show,
  View,
  computed,
  ref
} = Timeless;
import {
  source_value,
  dispose_all
} from "./shared.js";

const avatar_hues = [8, 32, 152, 200, 262, 316];

function avatar_hue(name) {
  const text = String(name || "");
  if (text === "") return avatar_hues[0];
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return avatar_hues[hash % avatar_hues.length];
}

function AvatarViewModel({
  src,
  name
}) {
  const failed_ = ref(false);
  const text = String(source_value(name) ?? "").trim();
  const label = text || "用户";
  const unlistens = [];
  if (src && typeof src === "object" && src.__is_ref && typeof src.subscribe === "function") {
    unlistens.push(src.subscribe({
      onChange: () => failed_.as(false)
    }));
  }
  const has_image_ = computed(failed_, (failed) => Boolean(String(source_value(src) ?? "").trim()) && !failed);
  return {
    label,
    hue: avatar_hue(text),
    has_image: has_image_,
    fail() {
      failed_.as(true);
    },
    destroy() {
      dispose_all(unlistens);
      failed_.destroy?.();
      has_image_.destroy?.();
    },
  };
}

function Avatar(props = {}) {
  const {
    src,
    name = "",
    fallback,
    size = "default",
    shape = "circle",
    class: custom_class,
    attributes = {},
    onUnmounted,
    ...rest
  } = props;
  const model = AvatarViewModel({
    src,
    name
  });
  const style = {
    "--frui-avatar-hue": String(model.hue),
    ...(rest.style || {})
  };
  return View({
    ...rest,
    class: atomic_classes([
      "display-inline-flex align-items-center justify-content-center flex-none width-32-pixels height-32-pixels overflow-hidden border-radius-50-percent color-color-text font-family-font-family font-weight-700 font-size-font-size-sm text-transform-uppercase user-select-none",
      shape === "square" ? "border-radius-radius-sm" : null,
      size !== "default" ?
      `${{"sm":"width-24-pixels height-24-pixels font-size-11-pixels","lg":"width-44-pixels height-44-pixels font-size-font-size-lg"}[size] || ""}` :
      null,
      custom_class,
    ].filter(Boolean).join(" ")),
    style: {
      ...{
        "--width-32-pixels": "32px",
        "--height-32-pixels": "32px",
        "--width-24-pixels": "24px",
        "--height-24-pixels": "24px",
        "--font-size-11-pixels": "11px",
        "--width-44-pixels": "44px",
        "--height-44-pixels": "44px"
      },
      ...(style)
    },
    attributes: {
      n: attributes.n || "avatar",
      role: "img",
      "aria-label": model.label,
      ...attributes
    },
    onUnmounted() {
      model.destroy();
      onUnmounted?.();
    },
  }, [
    Show({
      when: model.has_image,
      ok() {
        return Img({
          class: "display-block width-100-percent height-100-percent object-fit-cover border-radius-inherit",
          src,
          attributes: {
            n: "avatar-image",
            alt: ""
          },
          onError() {
            model.fail();
          },
        });
      },
      else() {
        return View({
          class: "",
          attributes: {
            n: "avatar-initial",
            "aria-hidden": "true"
          }
        }, [
          fallback ?? model.label.slice(0, 1).toUpperCase(),
        ]);
      },
    }),
  ]);
}

export {
  Avatar
};
