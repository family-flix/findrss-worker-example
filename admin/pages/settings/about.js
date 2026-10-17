import { SettingsAboutModel } from "./about.model.js";

const { View, Img, Link } = window.FindRSSAdminUI;

// Use the same self-contained GitHub mark as the discover header.
const github_icon_mask = "url(\"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox='0 0 24 24'%3E%3Cpath d='M12 .297a12 12 0 0 0-3.793 23.385c.6.111.82-.261.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.839 1.236 1.839 1.236 1.07 1.835 2.809 1.305 3.494.998.108-.776.418-1.305.762-1.605-2.665-.303-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.524.118-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 6.097c1.02.005 2.047.138 3.005.404 2.291-1.552 3.297-1.23 3.297-1.23.656 1.652.244 2.873.12 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.479 5.922.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .319.216.694.825.576A12.001 12.001 0 0 0 12 .297Z'/%3E%3C/svg%3E\")";

function SettingsAboutPage() {
  const { state } = SettingsAboutModel();
  return View({
    as: "section",
    class: "grid min-w-0 gap-space-4",
    attributes: { n: "settings-about", "aria-labelledby": "settings-about-title" },
  }, [
    View({ class: "flex items-center gap-space-3" }, [
      Img({
        src: state.logo,
        class: "flex-none",
        style: { width: "64px", height: "64px" },
        attributes: { n: "settings-about-logo", alt: "FindRSS Logo", width: 64, height: 64 },
      }),
      View({ class: "grid gap-space-1 min-w-0" }, [
        View({ as: "h2", class: "m-0 font-size-font-size-lg", attributes: { id: "settings-about-title" } }, [state.name]),
        View({ class: "text-muted text-sm", attributes: { n: "settings-about-version" } }, ["版本 v" + state.version]),
      ]),
    ]),
    View({ as: "p", class: "m-0 text-muted line-height-1-6", attributes: { n: "settings-about-description" } }, [state.description]),
    Link({
      href: state.github,
      class: "inline-flex items-center gap-space-2 justify-self-start text-link no-underline hover-text-decoration-underline break-anywhere",
      attributes: { n: "settings-about-github", target: "_blank", rel: "noopener noreferrer" },
    }, [
      View({
        class: "flex-none background-color-currentcolor",
        style: {
          width: "20px", height: "20px",
          "--github-icon-mask": github_icon_mask,
          mask: "var(--github-icon-mask) center / contain no-repeat",
          "-webkit-mask": "var(--github-icon-mask) center / contain no-repeat",
        },
        attributes: { n: "settings-about-github-icon", "aria-hidden": "true" },
      }),
      "GitHub · ltaoo/findrss-worker",
    ]),
  ]);
}

export { SettingsAboutPage };
