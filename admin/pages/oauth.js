import { initialize_admin_auth } from "../store.js";
import { OauthView } from "./oauth.view.js";

async function bootstrap() {
  const root = document.getElementById("admin-oauth-root");
  if (!root) return;
  try {
    const auth = initialize_admin_auth();
    if (!(await auth.beforeReady())) return;
    window.FindRSSAdminUI.DOM.render(OauthView(), root);
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : String(error);
    root.setAttribute("role", "alert");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
else bootstrap();
