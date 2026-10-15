import { AccessTokenModel } from "./access_token.js";

export function DeviceTokenModel(row = {}) {
  const state = {
    id: String(row.id ?? ""), name: String(row.name ?? ""), note: String(row.note ?? ""),
    token_hint: String(row.token_hint ?? ""), created_at: Number(row.created_at ?? 0),
    expires_at: row.expires_at ?? null, revoked_at: row.revoked_at ?? null,
    last_used_at: row.last_used_at ?? null,
  };
  const status = (now) => state.revoked_at !== null ? "revoked"
    : state.expires_at !== null && state.expires_at <= now ? "expired" : "active";
  return Object.freeze({
    ...state,
    is_active_at: (now = Date.now()) => status(now) === "active",
    toValue: (now = Date.now()) => ({ id: state.id, name: state.name, note: state.note,
      token_hint: state.token_hint, created_at: state.created_at, expires_at: state.expires_at,
      revoked_at: state.revoked_at, last_used_at: state.last_used_at, status: status(now) }),
  });
}
DeviceTokenModel.of = DeviceTokenModel;
DeviceTokenModel.MAX_TOKENS = 200;
DeviceTokenModel.parse = (body) => {
  const invalid = (message) => ({ ok: false, error: { status: 400, message } });
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("invalid JSON body");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) return invalid("name must contain 1–80 characters");
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 256)) return invalid("note must not exceed 256 characters");
  if (body.expires_in_seconds != null && typeof body.expires_in_seconds !== "number") return invalid("invalid expires_in_seconds");
  const lifetime = AccessTokenModel.validate_lifetime(body.expires_in_seconds);
  if (!lifetime.ok) return lifetime;
  return { ok: true, model: DeviceTokenModel({ name: body.name.trim(), note: (body.note || "").trim(),
    expires_at: lifetime.expires_in_seconds === null ? null : Date.now() + lifetime.expires_in_seconds * 1000 }) };
};
