// 模型密钥只在 API DO 保存；由部署级 ADMIN_PASSWORD 派生 AES-GCM 密钥。
export function create_script_agent_credentials(secret) {
  const key = async () => {
    if (!secret) throw new Error("ADMIN_PASSWORD 未配置，无法保存模型密钥");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("findrss-script-agent:" + secret));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  };
  return {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value)));
      return JSON.stringify({ v: 1, iv: Array.from(iv), data: Array.from(bytes) });
    },
    async decrypt(value) {
      try {
        const sealed = JSON.parse(value);
        if (sealed.v !== 1) throw new Error();
        const result = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(sealed.iv) }, await key(), new Uint8Array(sealed.data));
        return new TextDecoder().decode(result);
      } catch { throw new Error("模型密钥无法解密，请重新配置 API Key"); }
    },
  };
}
