import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const datetime_source = buildSync({
  entryPoints: [fileURLToPath(new URL("../../server/lib/datetime.js", import.meta.url))],
  bundle: true, write: false, format: "iife", globalName: "datetime",
}).outputFiles[0].text;

// Keep each model's module scope while existing VM fixtures supply component stubs.
export function page_source(name) {
  const read = file => readFileSync(new URL("../pages/" + file, import.meta.url), "utf8");
  const strip = source => source
    .replace(/^import \{([^}]+)\} from ["'][^"']*\/datetime\.js["'];?$/gm,
      (_, bindings) => `const {${bindings.replace(/\bas\b/g, ":")}} = (() => {\n${datetime_source}\nreturn datetime;\n})();`)
    .replace(/^import\s+(?:[^]*?\s+from\s+)?["'][^"']+["'];?[ \t]*(?:\r?\n|$)/gm, "")
    .replace(/^export \{[^}]*\};?$/gm, "");
  const model = read(name.replace(/\.js$/, ".model.js"));
  const exports = model.match(/^export \{([^}]+)\};?$/m)[1].trim();
  return "const { " + exports + " } = (() => {\n" + strip(model) + "\nreturn { " + exports + " };\n})();\n" + strip(read(name));
}
