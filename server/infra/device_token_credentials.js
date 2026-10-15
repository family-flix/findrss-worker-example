// 与模型 API Key 使用不同的 AES-GCM 密钥域；明文仅在管理员主动查看时解密。
export function create_device_token_credentials(secret) {
  const key = async () => {
    if (!secret) throw new Error("ADMIN_PASSWORD 未配置，无法保存设备 Token");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("findrss-device-token:" + secret));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  };
  return {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
      return JSON.stringify({ iv: Array.from(iv), data: Array.from(new Uint8Array(data)) });
    },
    async decrypt(value) {
      const sealed = JSON.parse(value);
      const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(sealed.iv) }, await key(), new Uint8Array(sealed.data));
      return new TextDecoder().decode(data);
    },
  };
}
