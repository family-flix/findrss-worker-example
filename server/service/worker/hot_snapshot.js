import { admin_authorized, admin_auth_required } from "./auth.js";
import { error_response } from "../../lib/http.js";
export function submit_hot_snapshot(env) {
  return env.APPLICATION.fetch(new Request("https://internal/_admin/hot/snapshot", {
    method: "POST"
  }));
}
export async function admin_hot_snapshot(request, env) {
  if (!admin_authorized(request, env)) return admin_auth_required();
  if (request.method !== "POST") return error_response("method not allowed", 405, {
    Allow: "POST"
  });
  if (request.headers.has("Origin") && request.headers.get("Origin") !== new URL(request.url).origin) {
    return error_response("origin rejected", 403);
  }
  if (!env.API_STORAGE || !env.APPLICATION) return error_response("hot snapshot service is unavailable", 503);
  return submit_hot_snapshot(env);
}
