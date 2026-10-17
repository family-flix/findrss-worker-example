// Stateless Streamable HTTP transport; intentionally no server-initiated SSE stream.
const versions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function handle_mcp(request, { name, tools, call }) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "origin rejected" }, 403);
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return json({ error: "application/json required" }, 415);
  const accept = request.headers.get("Accept") || "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) return json({ error: "Accept must include application/json and text/event-stream" }, 406);
  const version = request.headers.get("MCP-Protocol-Version");
  if (version && !versions.includes(version)) return json({ error: "unsupported protocol version" }, 400);
  if (Number(request.headers.get("Content-Length")) > 160 * 1024) return json({ error: "request body is too large" }, 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 160 * 1024) return json({ error: "request body is too large" }, 413);
  let message;
  try { message = JSON.parse(body); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  const error = (code, text, status = 200) => json({ jsonrpc: "2.0", id: message?.id ?? null, error: { code, message: text } }, status);
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string" ||
      (Object.hasOwn(message, "id") && typeof message.id !== "string" && typeof message.id !== "number") ||
      (message.params !== undefined && (!message.params || typeof message.params !== "object" || Array.isArray(message.params)))) return error(-32600, "Invalid Request", 400);
  if (!Object.hasOwn(message, "id")) return new Response(null, { status: 202 });
  let result;
  if (message.method === "initialize") {
    if (typeof message.params?.protocolVersion !== "string") return error(-32602, "protocolVersion is required");
    result = { protocolVersion: versions.includes(message.params.protocolVersion) ? message.params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name, version: "1.1.0" } };
  } else if (message.method === "ping") result = {};
  else if (message.method === "tools/list") result = { tools };
  else if (message.method === "tools/call") {
    const tool = tools.find((entry) => entry.name === message.params?.name);
    if (!tool) return error(-32602, "Unknown tool");
    const args = message.params.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) return error(-32602, "arguments must be an object");
    const schema = tool.inputSchema;
    for (const key of schema.required || []) if (!Object.hasOwn(args, key)) return error(-32602, "Missing argument: " + key);
    for (const [key, value] of Object.entries(args)) {
      const field = schema.properties[key];
      if (!field || (field.enum && !field.enum.includes(value)) || (field.type === "integer" ? !Number.isInteger(value) : typeof value !== field.type) ||
          (field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) return error(-32602, "Invalid argument: " + key);
    }
    try {
      const response = await call(tool.name, args);
      const payload = await response.json();
      result = { content: [{ type: "text", text: JSON.stringify(payload) }], isError: !response.ok };
    } catch {
      result = { content: [{ type: "text", text: "Tool execution failed" }], isError: true };
    }
  } else return error(-32601, "Method not found");
  return json({ jsonrpc: "2.0", id: message.id, result });
}
