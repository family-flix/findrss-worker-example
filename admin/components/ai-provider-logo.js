import {
  atomic_classes
} from "./frui/atomic.js";
const {
  View,
  Img,
  Show,
  computed
} = Timeless;
import {
  AIProviderLogoModel
} from "../domain/preferences/ai_provider_logo.js";

function AIProviderLogo({
  provider,
  logo,
  class: custom_class,
  attributes = {}
}) {
  const value = logo || computed(provider, provider => AIProviderLogoModel(provider).toValue());
  return View({
    class: atomic_classes([
      "display-inline-flex align-items-center justify-content-center flex-none inline-size-ai-provider-logo-size-space-5 block-size-ai-provider-logo-size-space-5 color-color-text",
      custom_class
    ].filter(Boolean).join(" ")),
    attributes: {
      n: "ai-provider-logo",
      "aria-hidden": "true",
      ...attributes
    }
  }, [
    Show({
      when: computed(value, value => Boolean(value?.src)),
      ok: () => Show({
        when: computed(value, value => value.monochrome),
        ok: () => View({
          class: "display-block inline-size-100-percent block-size-100-percent background-color-currentcolor mask-ai-provider-logo-url-center-contain-no-repeat webkit-mask-ai-provider-logo-url-center-contain-no-repeat",
          attributes: {
            n: "ai-provider-logo-mask"
          },
          style: {
            "--ai-provider-logo-url": computed(value, value => `url("${value.src}")`)
          },
        }),
        else: () => Img({
          src: computed(value, value => value.src),
          class: "display-block inline-size-100-percent block-size-100-percent object-fit-contain",
          attributes: {
            n: "ai-provider-logo-image",
            src: computed(value, value => value.src),
            alt: "",
            draggable: "false"
          }
        }),
      }),
      else: () => View({
        class: "display-inline-flex align-items-center justify-content-center inline-size-100-percent block-size-100-percent border-radius-radius-control background-color-surface-raised font-size-font-size-sm font-weight-600",
        attributes: {
          n: "ai-provider-logo-fallback"
        }
      }, [computed(value, value => value?.initial || "?")])
    }),
  ]);
}
export {
  AIProviderLogo
};
