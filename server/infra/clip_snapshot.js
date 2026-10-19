import { compile_script_module, execute_script } from "./script_sandbox.js";
import { ClipModel } from "../domain/clip.js";

export function create_clip_loader(puppeteer_navigate, script) {
  if (!puppeteer_navigate) return null;
  let compiled;
  return async (record, signal) => {
    signal?.throwIfAborted();
    const { metadata, error } = await (compiled ||= compile_script_module(script));
    if (error) throw new Error(error);
    // Keep the browser function's source intact; bundlers can add helpers outside its closure.
    const result = await execute_script(script, { ...metadata, config: { ...record, id_prefix: record.id } }, null,
      { method: "GET", pathname: "/region-clip", params: {}, query: {} }, [], "", null, signal,
      puppeteer_navigate, ClipModel.MAX_BYTES * 3);
    signal?.throwIfAborted();
    return JSON.parse(result.output);
  };
}
