import assert from "node:assert/strict";
import test from "node:test";

import { build_smtp_message, send_reader_verification_email } from "../server/infra/reader_smtp.js";

const encoder = new TextEncoder();

test("SMTP 邮件使用 UTF-8 MIME 编码并拒绝邮件头注入", () => {
  const message = build_smtp_message({
    from: "reader@example.com",
    to: "person@example.com",
    subject: "邮箱验证码",
    text: "验证码：123456",
  });
  assert.match(message, /^From: FindRSS Reader <reader@example\.com>/);
  assert.match(message, /Content-Transfer-Encoding: base64/);
  assert.match(message, /Subject: =\?UTF-8\?B\?/);
  assert.throws(
    () => build_smtp_message({
      from: "reader@example.com",
      to: "person@example.com",
      subject: "ok\r\nBcc: thief@example.com",
      text: "hello",
    }),
    /invalid SMTP subject/,
  );
});

test("阿里企业邮箱 SMTP 使用 465/TLS、AUTH LOGIN 并提交验证码", async () => {
  const response_lines = [
    "220 smtp.qiye.aliyun.com ready",
    "250-smtp.qiye.aliyun.com",
    "250 AUTH LOGIN",
    "334 VXNlcm5hbWU6",
    "334 UGFzc3dvcmQ6",
    "235 authenticated",
    "250 sender accepted",
    "250 recipient accepted",
    "354 send message",
    "250 queued",
    "221 goodbye",
  ];
  const reads = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(response_lines.join("\r\n") + "\r\n"));
      controller.close();
    },
  });
  const writes = [];
  const written = new WritableStream({
    write(chunk) {
      writes.push(new TextDecoder().decode(chunk));
    },
  });
  const connection = [];

  await send_reader_verification_email(
    {
      READER_SMTP_USER: "reader@example.com",
      READER_SMTP_PASSWORD: "smtp-secret",
    },
    { to: "person@example.com", code: "012345" },
    async (address, options) => {
      connection.push({ address, options });
      return {
        readable: reads,
        writable: written,
        opened: Promise.resolve(),
        async close() {},
      };
    },
  );

  assert.deepEqual(connection, [{
    address: { hostname: "smtp.qiye.aliyun.com", port: 465 },
    options: { secureTransport: "on" },
  }]);
  const transcript = writes.join("");
  assert.match(transcript, /EHLO findrss\r\n/);
  assert.match(transcript, /AUTH LOGIN\r\n/);
  assert.match(transcript, /MAIL FROM:<reader@example\.com>/);
  assert.match(transcript, /RCPT TO:<person@example\.com>/);
  assert.match(transcript, /DATA\r\n/);
  assert.doesNotMatch(transcript, /smtp-secret/);
  const encoded_message = transcript.split("DATA\r\n")[1].split("\r\n.\r\n")[0];
  const mime_body = encoded_message.split("\r\n\r\n")[1];
  const decoded_message = new TextDecoder().decode(
    Uint8Array.from(atob(mime_body.replaceAll("\r\n", "")), (value) => value.charCodeAt(0)),
  );
  assert.match(decoded_message, /邮箱验证码：012345/);
});

test("SMTP 未配置或验证码不合法时不会连接服务器", async () => {
  let connected = false;
  const connect_fn = async () => {
    connected = true;
    throw new Error("should not connect");
  };
  await assert.rejects(
    send_reader_verification_email({}, { to: "person@example.com", code: "123456" }, connect_fn),
    /not configured/,
  );
  await assert.rejects(
    send_reader_verification_email(
      { READER_SMTP_USER: "reader@example.com", READER_SMTP_PASSWORD: "secret" },
      { to: "person@example.com", code: "1234567" },
      connect_fn,
    ),
    /invalid reader verification code/,
  );
  assert.equal(connected, false);
});
