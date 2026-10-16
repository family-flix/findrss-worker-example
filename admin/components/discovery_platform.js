import { discovery_platform_id, discovery_platform_icon, platform_icon_url } from "../../server/lib/discovery_platform.js";
export { discovery_platform_id, discovery_platform_label, discovery_platform_icon, discovery_platforms, script_platform } from "../../server/lib/discovery_platform.js";

export function discovery_platform_icon_url(id, platforms = []) {
  if (id && typeof id === "object") {
    return platform_icon_url(id.icon) || discovery_platform_icon_url(discovery_platform_id(id), platforms);
  }
  if (id === "all") return "/platform-icons/all.svg";
  const platform = platforms.find(platform => platform.id === id);
  return platform_icon_url(platform?.icon) || "/platform-icons/" + discovery_platform_icon(id) + ".svg";
}
