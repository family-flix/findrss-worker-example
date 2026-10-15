// 对齐 Timeless Result / BizError 的 data、error、messages、code、data 契约。
export function script_result_helpers_source() {
  return String.raw`(() => {
class BizError extends Error {
  constructor(messages, code, data = null) {
    super(messages.join("\n"));
    this.name = "BizError";
    this.messages = messages;
    this.code = code;
    this.data = data;
  }
}
const Result = Object.freeze({
  Ok(data) { return { data, error: null }; },
  Err(message, code, data = null) {
    const original = message && typeof message === "object" && "error" in message ? message.error : message;
    const error = original instanceof BizError ? original : new BizError(
      Array.isArray(original) ? original.map(String) : [typeof original === "string" ? original : String(original?.message || "未知错误")],
      code ?? original?.code, data,
    );
    if (original?.stack && !(original instanceof BizError)) error.stack = original.stack;
    return { data, code: code ?? error.code, error };
  },
});
const native_parse = JSON.parse;
function parseJSON(text, reviver) {
  try { return Result.Ok(native_parse(text, reviver)); }
  catch (error) { return Result.Err(error, "UPSTREAM_INVALID_RESPONSE"); }
}
Object.defineProperties(globalThis, {
  BizError: { value: BizError }, Result: { value: Result }, parseJSON: { value: parseJSON },
});
})();`;
}
