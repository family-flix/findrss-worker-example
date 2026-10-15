const reader_session_prefix = "reader_v1";
const reader_session_duration_seconds = 12 * 60 * 60;
const password_iterations = 100_000;
const reader_verification_code_length = 6;
const reader_verification_code_range = 1_000_000;

/** @param {ArrayBuffer | Uint8Array} value */
function base64_url_encode(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} value */
function base64_url_decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/** @param {string} left @param {string} right */
function safe_equal(left, right) {
  const encoder = new TextEncoder();
  const left_bytes = encoder.encode(left);
  const right_bytes = encoder.encode(right);
  const length = Math.max(left_bytes.length, right_bytes.length);
  let difference = left_bytes.length ^ right_bytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left_bytes[index] ?? 0) ^ (right_bytes[index] ?? 0);
  }
  return difference === 0;
}

/** @param {string} secret @param {string} payload */
async function hmac(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64_url_encode(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
}

/** @returns {string} */
export function generate_password_salt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64_url_encode(bytes);
}

/** @returns {string} */
export function generate_reader_verification_code() {
  const limit = Math.floor(0x1_0000_0000 / reader_verification_code_range) *
    reader_verification_code_range;
  const bytes = new Uint8Array(4);
  let value;
  do {
    crypto.getRandomValues(bytes);
    value = new DataView(bytes.buffer).getUint32(0, false);
  } while (value >= limit);
  return String(value % reader_verification_code_range).padStart(
    reader_verification_code_length,
    "0",
  );
}

/** @param {string} secret @param {string} user_id @param {string} code */
export async function hash_reader_verification_code(secret, user_id, code) {
  return hmac(secret, "reader-email-verification:" + user_id + ":" + code);
}

/** @param {string} password @param {string} salt */
export async function hash_reader_password(password, salt) {
  const salt_bytes = base64_url_decode(salt);
  if (salt_bytes === null) throw new Error("invalid password salt");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return base64_url_encode(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt_bytes,
        iterations: password_iterations,
      },
      key,
      256,
    ),
  );
}

/** @param {string} password @param {string} salt @param {string} expected_hash */
export async function verify_reader_password(password, salt, expected_hash) {
  try {
    return safe_equal(await hash_reader_password(password, salt), expected_hash);
  } catch {
    return false;
  }
}

/**
 * @param {string} secret
 * @param {{ user_id: string, access_token_id: string }} identity
 * @param {number} [now]
 */
export async function sign_reader_session(secret, identity, now = Date.now()) {
  if (!secret || !identity.user_id || !identity.access_token_id) {
    throw new Error("invalid reader session identity");
  }
  const claims = {
    sub: identity.user_id,
    ati: identity.access_token_id,
    exp: Math.floor(now / 1000) + reader_session_duration_seconds,
  };
  const payload = base64_url_encode(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await hmac(secret, reader_session_prefix + "." + payload);
  return {
    session: reader_session_prefix + "." + payload + "." + signature,
    expires_at: claims.exp * 1000,
  };
}

/** @param {string} secret @param {string} session @param {number} [now] */
export async function verify_reader_session(secret, session, now = Date.now()) {
  const parts = session.split(".");
  if (!secret || parts.length !== 3 || parts[0] !== reader_session_prefix) return null;
  const payload_bytes = base64_url_decode(parts[1]);
  if (payload_bytes === null) return null;
  const expected = await hmac(secret, parts[0] + "." + parts[1]);
  if (!safe_equal(parts[2], expected)) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(payload_bytes));
    if (
      !claims ||
      typeof claims.sub !== "string" ||
      typeof claims.ati !== "string" ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= Math.floor(now / 1000)
    ) {
      return null;
    }
    return {
      user_id: claims.sub,
      access_token_id: claims.ati,
      expires_at: claims.exp * 1000,
    };
  } catch {
    return null;
  }
}

export { reader_session_duration_seconds, reader_verification_code_length };
