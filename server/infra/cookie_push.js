export function plain_cookie_push(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Cookie 推送数据必须是对象");
  if (Object.hasOwn(body, "cookies")) {
    if (!Array.isArray(body.cookies)) throw new Error("cookies 必须是数组");
    return body.cookies;
  }
  if (!body.cookie_data || typeof body.cookie_data !== "object" || Array.isArray(body.cookie_data)) {
    throw new Error("Cookie 推送数据缺少 cookies 或 cookie_data");
  }
  const cookies = [];
  for (const entries of Object.values(body.cookie_data)) {
    if (!Array.isArray(entries)) throw new Error("cookie_data 的值必须是数组");
    cookies.push(...entries);
  }
  return cookies;
}

function decode_base64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function equal(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

export async function decrypt_cookie_push(body, configured_uuid, configured_key) {
  if (body?.crypto_type === "none" || (!body?.encrypted && (Object.hasOwn(body || {}, "cookies") || Object.hasOwn(body || {}, "cookie_data")))) {
    return plain_cookie_push(body);
  }
  const uuid = typeof body?.uuid === "string" ? body.uuid.trim() : "";
  const encrypted = typeof body?.encrypted === "string" ? body.encrypted.trim() : "";
  const crypto_type = typeof body?.crypto_type === "string" ? body.crypto_type.trim().toLowerCase() : "legacy";
  if (!uuid || !encrypted) throw new Error("Cookie 加密推送请求缺少 uuid 或 encrypted");
  if (!configured_uuid || !equal(uuid, configured_uuid)) throw new Error("Cookie 推送 UUID 不匹配");
  if (crypto_type !== "aes-128-cbc-fixed") throw new Error("仅支持 crypto_type=aes-128-cbc-fixed");
  if (!/^[0-9a-fA-F]{16}$/.test(configured_key)) throw new Error("COOKIE_PUSH_KEY 必须是 16 位十六进制字符");
  let plaintext;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(configured_key.toLowerCase()), { name: "AES-CBC" }, false, ["decrypt"],
    );
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: new Uint8Array(16) }, key, decode_base64(encrypted),
    );
  } catch {
    throw new Error("Cookie 推送数据解密失败");
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Cookie 推送解密数据不是有效 JSON");
  }
  if (!data?.cookie_data || typeof data.cookie_data !== "object") {
    throw new Error("Cookie 推送解密数据缺少 cookie_data");
  }
  return Object.values(data.cookie_data).flatMap((cookies) => Array.isArray(cookies) ? cookies : []);
}
