let frui_uid = 0;

function source_value(value, fallback) {
  return value && typeof value === "object" && "value" in value ?
    value.value :
    value === undefined ? fallback : value;
}

function subscribe_source(source, handler) {
  return source && typeof source.subscribe === "function" ?
    source.subscribe({
      onChange: handler
    }) :
    null;
}

function dispose_all(unlistens) {
  for (const unlisten of unlistens)
    if (typeof unlisten === "function") unlisten();
}

function as_children(value) {
  if (value === undefined || value === null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

function next_uid(prefix) {
  frui_uid += 1;
  return `${prefix}-${frui_uid}`;
}

function normalize_autocomplete(value) {
  const resolved = source_value(value);
  if (resolved === undefined || resolved === null) return undefined;
  if (resolved === true) return "on";
  if (resolved === false) return "off";
  const text = String(resolved).trim();
  return text === "" ? undefined : text;
}

export {
  source_value,
  subscribe_source,
  dispose_all,
  as_children,
  next_uid,
  normalize_autocomplete
};
