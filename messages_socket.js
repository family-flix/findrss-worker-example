export function messages_socket(request, service) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("websocket upgrade required", { status: 426 });
  }
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  const send = value => {
    try { server.send(JSON.stringify(value)); }
    catch { service.message_listeners.delete(send); }
  };
  service.message_listeners.add(send);
  const remove = () => service.message_listeners.delete(send);
  server.addEventListener("close", remove);
  server.addEventListener("error", remove);
  send({ type: "messages.changed" });
  return new Response(null, { status: 101, webSocket: client });
}
