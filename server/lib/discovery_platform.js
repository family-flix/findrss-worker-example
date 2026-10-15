import { DISCOVERY_PLATFORM_LABELS } from "./constants.js";

export function discovery_platform_id(value) {
  const label = String(value || "").trim();
  if (!label || label === "网站" || label === "网页") return "website";
  return Object.keys(DISCOVERY_PLATFORM_LABELS).find(id => DISCOVERY_PLATFORM_LABELS[id] === label) || label;
}

export function discovery_platform_label(id) {
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id) ? DISCOVERY_PLATFORM_LABELS[id] : id;
}

export function discovery_platform_icon(id) {
  return Object.hasOwn(DISCOVERY_PLATFORM_LABELS, id) ? id : "website";
}

export function discovery_platforms(platforms = [], sources = []) {
  const ids = new Set(["website", ...platforms.map(discovery_platform_id),
    ...sources.map(source => discovery_platform_id(source.source_type))]);
  return [...ids].map(id => ({ id, label: discovery_platform_label(id) }));
}
