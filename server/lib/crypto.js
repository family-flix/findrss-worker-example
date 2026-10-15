// 摘要工具：用于 Token 鉴权与兑换码校验；设备 Token 的可查看副本另行加密。
//
// 纯模块，可在 node --test 下直接覆盖。

/**
 * @param {string} value
 * @returns {Promise<string>}
 */
export async function sha256_hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
