import { RankViewModel } from "./model.js";
import { RankPage } from "./view.js";

function bootstrap() {
  const root = document.getElementById("rank-root");
  const catalog = document.getElementById("rank-catalog");
  if (!root || !catalog) return;
  const model = RankViewModel(JSON.parse(catalog.textContent), new URL(window.location.href).searchParams);
  const page = RankPage({ vm$: model });
  if (root.firstChild) globalThis.Timeless.DOM.hydrate(page, root);
  else globalThis.Timeless.DOM.render(page, root);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  else bootstrap();
}
