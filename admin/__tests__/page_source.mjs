import { readFileSync } from "node:fs";

// Keep each model's module scope while existing VM fixtures supply component stubs.
export function page_source(name) {
  const read = file => readFileSync(new URL("../pages/" + file, import.meta.url), "utf8");
  const strip = source => source
    .replace(/^import\s+(?:[^]*?\s+from\s+)?["'][^"']+["'];?[ \t]*(?:\r?\n|$)/gm, "")
    .replace(/^export \{[^}]*\};?$/gm, "");
  const model = read(name.replace(/\.js$/, ".model.js"));
  const exports = model.match(/^export \{([^}]+)\};?$/m)[1].trim();
  return "const { " + exports + " } = (() => {\n" + strip(model) + "\nreturn { " + exports + " };\n})();\n" + strip(read(name));
}
