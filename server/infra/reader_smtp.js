const smtp_host_default = "smtp.qiye.aliyun.com";
const smtp_port = 465;
const smtp_timeout_ms = 10_000;

const encoder = new TextEncoder();

/** @param {string} value */
function base64_utf8(value) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** @param {string} value */
function strict_mailbox(value) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value)
  ) {
    throw new Error("invalid email address for SMTP");
  }
  return value;
}

/** @param {string} value */
function wrap_base64(value) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/**
 * @param {{ from: string, to: string, subject: string, text: string }} message
 * @returns {string}
 */
export function build_smtp_message(message) {
  const from = strict_mailbox(message.from);
  const to = strict_mailbox(message.to);
  if (/\r|\n/.test(message.subject)) throw new Error("invalid SMTP subject");
  const subject = "=?UTF-8?B?" + base64_utf8(message.subject) + "?=";
  const body = wrap_base64(base64_utf8(message.text));
  return [
    "From: FindRSS Reader <" + from + ">",
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** @param {Promise<unknown>} promise @param {string} operation */
async function with_smtp_timeout(promise, operation) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout_id;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout_id = setTimeout(() => reject(new Error("SMTP " + operation + " timed out")), smtp_timeout_ms);
      }),
    ]);
  } finally {
    if (timeout_id !== undefined) clearTimeout(timeout_id);
  }
}

/** @param {ReadableStreamDefaultReader<Uint8Array>} reader */
function create_smtp_response_reader(reader) {
  const decoder = new TextDecoder();
  let buffer = "";

  return async function read_smtp_response() {
    /** @type {string[]} */
    const lines = [];
    /** @type {number | null} */
    let response_code = null;

    for (;;) {
      const newline_index = buffer.indexOf("\n");
      if (newline_index < 0) {
        const chunk = await with_smtp_timeout(reader.read(), "response");
        if (chunk.done) throw new Error("SMTP connection closed unexpectedly");
        buffer += decoder.decode(chunk.value, { stream: true });
        continue;
      }

      const line = buffer.slice(0, newline_index).replace(/\r$/, "");
      buffer = buffer.slice(newline_index + 1);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (match === null) throw new Error("SMTP returned an invalid response");
      const code = Number(match[1]);
      if (response_code !== null && code !== response_code) {
        throw new Error("SMTP returned an inconsistent response");
      }
      response_code = code;
      lines.push(match[3]);
      if (match[2] === " ") return { code, lines };
    }
  };
}

/** @param {WritableStreamDefaultWriter<Uint8Array>} writer */
function create_smtp_command(writer, read_response) {
  return async function smtp_command(command, expected_codes) {
    await with_smtp_timeout(writer.write(encoder.encode(command + "\r\n")), "write");
    const response = await read_response();
    if (!expected_codes.includes(response.code)) {
      throw new Error("SMTP command rejected with code " + response.code);
    }
    return response;
  };
}

/** @param {string} value */
function dot_stuff(value) {
  return value.replace(/(^|\r\n)\./g, "$1..");
}

/**
 * @param {{ READER_SMTP_USER?: string, READER_SMTP_PASSWORD?: string, READER_SMTP_HOST?: string }} env
 * @param {{ to: string, code: string }} message
 * @param {(address: { hostname: string, port: number }, options: { secureTransport: "on" }) => { readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>, opened?: Promise<unknown>, close(): Promise<void> } | Promise<{ readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>, opened?: Promise<unknown>, close(): Promise<void> }>} [connect_fn]
 * @returns {Promise<void>}
 */
export async function send_reader_verification_email(env, message, connect_fn) {
  const username = String(env.READER_SMTP_USER ?? "").trim();
  const password = String(env.READER_SMTP_PASSWORD ?? "");
  if (!username || !password) throw new Error("Reader SMTP is not configured");
  const from = strict_mailbox(username);
  const to = strict_mailbox(message.to);
  if (!/^\d{6}$/.test(message.code)) throw new Error("invalid reader verification code");

  const connector = connect_fn ?? (await import("cloudflare:sockets")).connect;
  const socket = await connector(
    { hostname: String(env.READER_SMTP_HOST || smtp_host_default), port: smtp_port },
    { secureTransport: "on" },
  );
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  try {
    if (socket.opened) await with_smtp_timeout(socket.opened, "connection");
    const read_response = create_smtp_response_reader(reader);
    const command = create_smtp_command(writer, read_response);
    const greeting = await read_response();
    if (greeting.code !== 220) throw new Error("SMTP server rejected the connection");
    await command("EHLO findrss", [250]);
    await command("AUTH LOGIN", [334]);
    await command(base64_utf8(username), [334]);
    await command(base64_utf8(password), [235]);
    await command("MAIL FROM:<" + from + ">", [250]);
    await command("RCPT TO:<" + to + ">", [250, 251]);
    await command("DATA", [354]);

    const body = build_smtp_message({
      from,
      to,
      subject: "FindRSS Reader 邮箱验证码",
      text: [
        "你正在注册 FindRSS Reader。",
        "",
        "邮箱验证码：" + message.code,
        "验证码 15 分钟内有效，且只能使用一次。",
        "如果这不是你的操作，请忽略此邮件。",
      ].join("\n"),
    });
    await with_smtp_timeout(
      writer.write(encoder.encode(dot_stuff(body) + "\r\n.\r\n")),
      "message write",
    );
    const accepted = await read_response();
    if (accepted.code !== 250) throw new Error("SMTP server did not accept the message");
    try {
      await command("QUIT", [221]);
    } catch {
      // The server has already accepted the message; a QUIT failure does not undo delivery.
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
    try {
      writer.releaseLock();
    } catch {}
    try {
      await socket.close();
    } catch {}
  }
}

export { smtp_host_default, smtp_port };
