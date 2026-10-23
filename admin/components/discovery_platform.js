import {
  discovery_platform_id,
  discovery_platform_icon,
  platform_icon_url,
} from "../../server/lib/discovery_platform.js";
export {
  discovery_platform_id,
  discovery_platform_label,
  discovery_platform_icon,
  discovery_platforms,
  script_platform,
} from "../../server/lib/discovery_platform.js";

export function discovery_platform_icon_url(id, platforms = []) {
  if (id && typeof id === "object") {
    return (
      platform_icon_url(id.icon) ||
      discovery_platform_icon_url(discovery_platform_id(id), platforms)
    );
  }
  if (id === "all") {
    return "/platform-icons/all.svg";
  }
  const platform = platforms.find((platform) => platform.id === id);
  return (
    platform_icon_url(platform?.icon) ||
    "/platform-icons/" + discovery_platform_icon(id) + ".svg"
  );
}

export function PlatformOptionView(ui, id, platforms, label) {
  const { View, Img, combine, ref } = ui;
  return View(
    {
      class: "inline-flex items-center",
      style: { gap: "6px" },
      attributes: { n: "discovery-platform-option" },
    },
    [
      Img({
        class: "block flex-none object-fit-contain",
        style: { width: "18px", height: "18px" },
        src: combine(
          { id: typeof id === "string" ? ref(id) : id, platforms },
          (values) => discovery_platform_icon_url(values.id, values.platforms),
        ),
        attributes: {
          n: "discovery-platform-icon",
          alt: "",
          "aria-hidden": "true",
          width: "18",
          height: "18",
        },
      }),
      label,
    ],
  );
}

export function SourceSelect(ui, { platforms = ui.ref([]), ...props } = {}) {
  return ui.Select({
    ...props,
    render_option: ({ value, label }) =>
      PlatformOptionView(ui, value, platforms, label),
    render_value: ({ state, label }) =>
      PlatformOptionView(
        ui,
        ui.computed(state, (value) => value.value),
        platforms,
        label,
      ),
  });
}
