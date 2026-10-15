/** 按字节上限流式读取响应体，超限即取消。 */
export async function read_limited_body(response, limit) {
  const declared = Number(response.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** 按字节上限读取文档，并按响应头或 meta charset 解码。 */
export async function read_document_text(response, limit, on_bytes) {
  const body = await read_limited_body(response, limit);
  if (body === null) return null;
  on_bytes?.(body.byteLength);
  const content_type = response.headers.get("Content-Type") ?? "";
  const head = new TextDecoder("latin1").decode(body.subarray(0, 2048));
  const charset = sniff_charset(content_type, head);
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function supported_charset(label) {
  if (typeof label !== "string") return null;
  const normalized = label.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (normalized === "") return null;
  try {
    new TextDecoder(normalized);
    return normalized;
  } catch {
    return null;
  }
}

export function sniff_charset(content_type, head_text) {
  if (typeof content_type === "string") {
    const match = /charset\s*=\s*["']?\s*([A-Za-z0-9._:+-]+)/i.exec(content_type);
    const label = supported_charset(match?.[1]);
    if (label !== null) return label;
  }
  if (typeof head_text === "string") {
    const meta_charset = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._:+-]+)/i.exec(head_text);
    const meta_label = supported_charset(meta_charset?.[1]);
    if (meta_label !== null) return meta_label;
    const http_equiv = /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([A-Za-z0-9._:+-]+)/i.exec(head_text);
    const equiv_label = supported_charset(http_equiv?.[1]);
    if (equiv_label !== null) return equiv_label;
  }
  return "utf-8";
}
