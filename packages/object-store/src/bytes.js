// 字节 / 文本工具：`store.js` 与 `memory.js` 共用。
//
// 零依赖、无环境假设：只用 TextEncoder/TextDecoder 与标准的读流原语，
// 所以同一份代码在 workerd、Node 与浏览器里都跑得起来。

/**
 * UTF-8 字节数（不是字符串长度）。
 * @param {unknown} value
 * @returns {number}
 */
export function utf8_length(value) {
  return new TextEncoder().encode(typeof value === "string" ? value : String(value ?? "")).byteLength;
}

/**
 * @param {unknown} text
 * @returns {Uint8Array}
 */
export function utf8_bytes(text) {
  return new TextEncoder().encode(typeof text === "string" ? text : String(text ?? ""));
}

/**
 * 尽力求一个值在存储里的字节数：流式对象无法在不消费它的前提下量出大小，
 * 返回 `null`（调用方当成「未知」而不是 0 之外的任何猜测）。
 * @param {unknown} value
 * @returns {number | null}
 */
export function byte_length(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return utf8_length(value);
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  return null;
}

/**
 * 把一个可写入桶的值读成字节。**只给内存桶/测试用**——真实写入路径（`put`）
 * 原样透传，绝不在这里预先 buffer（那会让大正文多占一份内存）。
 * @param {unknown} value
 * @returns {Promise<Uint8Array>}
 */
export async function value_to_bytes(value) {
  if (value === null || value === undefined) return new Uint8Array(0);
  if (typeof value === "string") return utf8_bytes(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (typeof value.getReader === "function") return read_stream_bytes(value);
  return utf8_bytes(String(value));
}

/**
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function value_to_text(value) {
  if (typeof value === "string") return value;
  return new TextDecoder("utf-8").decode(await value_to_bytes(value));
}

/**
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {Promise<Uint8Array>}
 */
async function read_stream_bytes(stream) {
  const reader = stream.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
