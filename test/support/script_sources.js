import { script_sources } from "../../server/infra/builtin_script_sources.js";

export function read_script(path) {
  if (!Object.hasOwn(script_sources, path)) throw new Error("Unknown bundled script: " + path);
  return script_sources[path];
}

export function script_names(kind) {
  const prefix = kind + "/";
  return Object.keys(script_sources).filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length)).sort();
}
