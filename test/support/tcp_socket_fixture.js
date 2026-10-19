import assert from "node:assert/strict";

export function connect(address, options) {
  assert.equal(typeof globalThis.__testTcpConnect, "function", "测试必须显式安装 TCP socket fixture");
  return globalThis.__testTcpConnect(address, options);
}

// 将真实 HTTP 字节请求接到已有 fetch fixture，脚本测试仍经过完整 TCP 编解码。
export function mock_tcp_http(t) {
  const previous = globalThis.__testTcpConnect;
  const connections = [];
  const requests = [];
  globalThis.__testTcpConnect = (address, options) => {
    const connection = { address, options, closed: false };
    connections.push(connection);
    let controller, request = Buffer.alloc(0), sent = false;
    const readable = new ReadableStream({ start(value) { controller = value; } });
    const writable = new WritableStream({ async write(chunk) {
      request = Buffer.concat([request, chunk]);
      const end = request.indexOf("\r\n\r\n");
      if (end < 0 || sent) return;
      const [first, ...lines] = request.subarray(0, end).toString().split("\r\n");
      const [method, target] = first.split(" ");
      const headers = new Headers(lines.map(line => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon), line.slice(colon + 1).trim()];
      }));
      const length = Number(headers.get("content-length") || 0);
      if (request.length - end - 4 < length) return;
      sent = true;
      const url = (options.secureTransport === "on" ? "https://" : "http://") + headers.get("host") + target;
      const spec = { method, headers, ...(method === "POST" ? { body: request.subarray(end + 4).toString() } : {}) };
      requests.push({ url, ...spec });
      const response = await globalThis.fetch(url, spec);
      const body = Buffer.from(await response.arrayBuffer());
      const response_headers = new Headers(response.headers);
      response_headers.set("Content-Length", String(body.length));
      controller.enqueue(Buffer.concat([
        Buffer.from("HTTP/1.1 " + response.status + " OK\r\n" + [...response_headers].map(([name, value]) => name + ": " + value + "\r\n").join("") + "\r\n"), body,
      ]));
    } });
    return { readable, writable, opened: Promise.resolve(), async close() {
      connection.closed = true;
      try { controller.close(); } catch {}
    } };
  };
  t.after(() => { globalThis.__testTcpConnect = previous; });
  return { connections, requests };
}
