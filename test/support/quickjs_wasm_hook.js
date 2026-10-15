import { readFile } from "node:fs/promises";
export async function load(url, context, next_load) {
  if (url.endsWith("/quickjs.wasm")) {
    const bytes = await readFile(new URL(url));
    return { format: "module", shortCircuit: true,
      source: `export default new WebAssembly.Module(Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64"));` };
  }
  return next_load(url, context);
}
