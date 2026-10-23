import { initialize_admin_auth } from "../store.js";
import { LoginViewModel } from "./login.model.js";

const Timeless = window.FindRSSAdminUI;

if (!Timeless || !Timeless.DOM) {
  throw new Error("FindRSS 登录页无法启动：Timeless 运行时未加载");
}

const { Button, Form, Icon, Img, Input, Show, View, computed } = Timeless;

function LoginView() {
  const vm$ = LoginViewModel();
  return View(
    {
      class: "box-border w-full",
      style: {
        width: "min(440px, calc(100vw - 32px))",
        margin: "0 auto",
        padding: "32px 0",
      },
      attributes: { n: "admin-login-shell" },
    },
    [
      Form(
        {
          class:
            "box-border rounded-card bg-surface box-shadow-shadow-card max-760-padding",
          style: {
            padding: "30px",
            "backdrop-filter": "blur(18px)",
            "--max-760-padding": "24px 20px",
          },
          attributes: { n: "admin-login-form" },
          onSubmit(event) {
            event.preventDefault();
            return vm$.methods.login();
          },
        },
        [
          View(
            {
              class: "box-border flex justify-center",
              attributes: { n: "admin-login-brand" },
            },
            [
              Img({
                src: "/brand/logo.svg",
                class: "box-border block flex-none",
                style: {
                  width: "96px",
                  height: "96px",
                },
                attributes: {
                  n: "admin-login-logo",
                  alt: "FindRSS Logo",
                  width: 96,
                  height: 96,
                },
              }),
            ],
          ),
          View(
            {
              class: "box-border m-0 text-center",
              style: {
                "font-size": "26px",
                "font-weight": "740",
                "letter-spacing": "-.03em",
              },
              attributes: { n: "admin-login-heading" },
            },
            ["登录 FindRSS"],
          ),
          View(
            {
              class: "box-border grid text-muted",
              style: {
                gap: "7px",
                "margin-top": "68px",
                "font-size": "12px",
              },
              attributes: { n: "admin-login-password-field" },
            },
            [
              Input({
                class: "box-border",
                store: vm$.password_input$,
                value: vm$.state.password,
                name: "password",
                placeholder: "请输入密码",
                attributes: {
                  n: "admin-login-password-input",
                  id: "admin-login-password",
                  "aria-label": "密码",
                  type: "password",
                  autofocus: "",
                  required: "",
                },
                onInput(event) {
                  vm$.methods.setPassword(event.target.value);
                },
                autoComplete: "current-password",
                suffix: Button({
                  variant: "ghost",
                  style: {
                    width: "32px",
                    height: "32px",
                    "min-height": "32px",
                    padding: "0",
                  },
                  attributes: {
                    n: "admin-login-password-visibility",
                    type: "button",
                    "aria-label": computed(vm$.state.password_visible, (visible) =>
                      visible ? "隐藏密码" : "显示密码",
                    ),
                    "aria-pressed": computed(vm$.state.password_visible, String),
                    "aria-controls": "admin-login-password",
                  },
                  icon: Icon(computed(vm$.state.password_visible, (visible) =>
                    visible ? "eye-off" : "eye",
                  )),
                  onClick: vm$.methods.toggle_password_visibility,
                }),
              }),
            ],
          ),
          Show({
            when: computed(vm$.state.error, Boolean),
            ok() {
              return View(
                {
                  class: "box-border rounded-card bg-danger-bg text-danger",
                  style: {
                    "margin-top": "15px",
                    padding: "11px 12px",
                    "font-size": "12px",
                    "line-height": "1.5",
                  },
                  attributes: { n: "admin-login-error", role: "alert" },
                },
                [vm$.state.error],
              );
            },
          }),
          Button(
            {
              class: "box-border w-full flex-none",
              style: {
                "margin-top": "20px",
                padding: "12px 16px",
              },
              variant: "primary",
              disabled: computed(
                vm$.state.loading,
                (loading) => loading || undefined,
              ),
              attributes: { n: "admin-login-submit", type: "submit" },
            },
            [
              computed(vm$.state.loading, (loading) =>
                loading ? "正在登录…" : "登录",
              ),
            ],
          ),
        ],
      ),
    ],
  );
}

async function bootstrap() {
  const root_node = document.getElementById("admin-login-root");
  if (!root_node) throw new Error("FindRSS 登录页无法启动：缺少根节点");
  try {
    const auth = initialize_admin_auth();
    if (!(await auth.beforeReady())) return;
    Timeless.DOM.render(LoginView(), root_node);
  } catch (error) {
    root_node.textContent =
      error instanceof Error ? error.message : String(error);
    root_node.setAttribute("data-auth-error", "true");
    root_node.className = "rounded-card bg-danger-bg text-danger";
    root_node.style.padding = "16px";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
