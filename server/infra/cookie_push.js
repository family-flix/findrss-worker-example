export function plain_cookie_push(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") throw new Error("Cookie 推送数据必须是数组或对象");
  if (Object.hasOwn(body, "cookies")) {
    if (!Array.isArray(body.cookies)) throw new Error("cookies 必须是数组");
    return body.cookies;
  }
  const cookie_data = Object.hasOwn(body, "cookie_data") ? body.cookie_data : body;
  if (!cookie_data || typeof cookie_data !== "object" || Array.isArray(cookie_data)) {
    throw new Error("Cookie 分组数据必须是对象");
  }
  const cookies = [];
  for (const entries of Object.values(cookie_data)) {
    if (!Array.isArray(entries)) throw new Error("Cookie 分组的值必须是数组");
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
  if (typeof body?.data !== "string" || !body.data.trim()) throw new Error("Cookie 推送 data 必须是非空字符串");
  const crypto_type = body.crypto_type === undefined ? "none" :
    (typeof body.crypto_type === "string" ? body.crypto_type.trim().toLowerCase() : "");
  if (!["none", "aes-128-cbc-fixed", "aes-256-cbc", "legacy"].includes(crypto_type)) {
    throw new Error("仅支持 crypto_type=none、aes-128-cbc-fixed、aes-256-cbc 或 legacy");
  }
  let plaintext = body.data;
  if (crypto_type !== "none") {
    const uuid = typeof body.uuid === "string" ? body.uuid.trim() : "";
    if (!uuid) throw new Error("Cookie 加密推送请求缺少 uuid");
    if (!configured_uuid || !equal(uuid, configured_uuid)) throw new Error("Cookie 推送 UUID 不匹配");
    if (!/^[0-9a-fA-F]{16}$/.test(configured_key)) throw new Error("COOKIE_PUSH_KEY 必须是 16 位十六进制字符");
    try {
      let key_bytes = new TextEncoder().encode(configured_key.toLowerCase());
      let iv = new Uint8Array(16);
      let ciphertext = decode_base64(body.data.trim());
      if (crypto_type !== "aes-128-cbc-fixed") {
        if (ciphertext.length < 32 || (ciphertext.length - 16) % 16 !== 0 ||
            new TextDecoder().decode(ciphertext.subarray(0, 8)) !== "Salted__") {
          throw new Error("invalid OpenSSL ciphertext");
        }
        const salt = ciphertext.subarray(8, 16);
        const key_iv = new Uint8Array(48);
        let previous = new Uint8Array(0);
        // CryptoJS/OpenSSL EVP_BytesToKey：三个 MD5 块组成 32 字节密钥和 16 字节 IV。
        for (let offset = 0; offset < key_iv.length; offset += 16) {
          const input = new Uint8Array(previous.length + key_bytes.length + salt.length);
          input.set(previous);
          input.set(key_bytes, previous.length);
          input.set(salt, previous.length + key_bytes.length);
          previous = new Uint8Array(await crypto.subtle.digest("MD5", input));
          key_iv.set(previous, offset);
        }
        key_bytes = key_iv.subarray(0, 32);
        iv = key_iv.subarray(32);
        ciphertext = ciphertext.subarray(16);
      }
      const key = await crypto.subtle.importKey(
        "raw", key_bytes, { name: "AES-CBC" }, false, ["decrypt"],
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv }, key, ciphertext,
      );
      plaintext = new TextDecoder().decode(decrypted);
    } catch {
      throw new Error("Cookie 推送数据解密失败");
    }
  }
  let data;
  try {
    data = JSON.parse(plaintext);
  } catch {
    throw new Error("Cookie 推送数据不是有效 JSON");
  }
  return plain_cookie_push(data);
}
