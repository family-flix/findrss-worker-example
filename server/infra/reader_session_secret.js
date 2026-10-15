// 阅读端会话签名密钥的选择逻辑。单独成模块以便在纯 node --test 下断言，
// index.js 依赖 `cloudflare:workers`，不能直接被 Node 加载。
//
// 为什么需要这个回退：中央会话原先用 DEVICE_TOKEN 签名。改成独立的
// READER_SESSION_SECRET 之后，凡是还没有配新 secret 的部署都必须继续用旧密钥，
// 否则升级瞬间所有已签发的会话失效、所有人被踢下线。因此：
//   配了 READER_SESSION_SECRET → 用它（阅读端单元也用它，两边可互换校验）
//   没配                        → 回退旧 DEVICE_TOKEN；新部署再回退 ADMIN_PASSWORD
//
// 注意：独立的 findrss-reader 单元没有这个回退——它只认自己的
// READER_SESSION_SECRET，未配置时直接 500，而不是悄悄用别的密钥签发。

/**
 * @param {{ READER_SESSION_SECRET?: unknown, DEVICE_TOKEN?: unknown, ADMIN_PASSWORD?: unknown }} env
 * @returns {string}
 */
export function reader_session_secret(env) {
  const configured = env?.READER_SESSION_SECRET;
  if (typeof configured === "string" && configured !== "") return configured;
  const fallback = env?.DEVICE_TOKEN;
  if (typeof fallback === "string" && fallback !== "") return fallback;
  return typeof env?.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : "";
}
