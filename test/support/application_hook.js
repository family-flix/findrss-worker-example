import { readFile } from "node:fs/promises";
export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return {
    url: new URL('./workers_fixture.js', import.meta.url).href,
    shortCircuit: true
  };
  if (specifier === "timeless-ssr" || specifier === "timeless") return {
    url: new URL(specifier === "timeless" ? "../../public/assets/timeless/0.34.2/timeless.lite.esm.js" : "../../public/assets/timeless/0.34.2/timeless.ssr.esm.js", import.meta.url).href,
    shortCircuit: true
  };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (/\.(css|html|svg)$/.test(url)) return {
    format: "module",
    source: "export default " + JSON.stringify(await readFile(new URL(url), "utf8")),
    shortCircuit: true
  };
  return next(url, context);
}
