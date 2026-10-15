import { readFile, readdir, writeFile } from "node:fs/promises";
import { inline_builders } from "../examples/scripts/lib/builders.mjs";

const directory = new URL("../examples/scripts/", import.meta.url);
const start_marker = "// BEGIN COMMON FEED BUILDERS";
const end_marker = "// END COMMON FEED BUILDERS";
const common_source = start_marker + "\n" + inline_builders() + "\n" + end_marker;
const check = process.argv.includes("--check");
const pending = [];
for (const name of (await readdir(directory)).filter((name) => name.endsWith(".js")).sort()) {
  const path = new URL(name, directory);
  const source = await readFile(path, "utf8");
  const start = source.indexOf(start_marker), end = source.indexOf(end_marker);
  if (start < 0 || end < start || source.indexOf(start_marker, start + 1) >= 0 || source.indexOf(end_marker, end + 1) >= 0) {
    throw new Error(name + " 缺少唯一的公共构建器区块");
  }
  const updated = source.slice(0, start) + common_source + source.slice(end + end_marker.length);
  if (source !== updated) pending.push({ name, path, updated });
}
if (check && pending.length) {
  throw new Error("公共构建器未同步：" + pending.map((item) => item.name).join(", "));
}
for (const item of pending) await writeFile(item.path, item.updated);
console.log(check ? "公共构建器已同步" : "已同步 " + pending.length + " 个脚本");
