import { SettingsModel } from "./settings.model.js";
import { DeviceTokensModel } from "./dashboard.model.js";
import { DeviceTokensView } from "./dashboard.js";
import { SnapshotSettingsModel } from "../components/snapshot_settings.model.js";
import { PollPolicyView } from "../components/poll_policy.js";

const { View, Button, Show, computed, AIPreferencesView } =
  window.FindRSSAdminUI;

function SettingsPage({ view } = {}) {
  const model = SettingsModel();
  const snapshots = SnapshotSettingsModel({ ui: window.FindRSSAdminUI });
  const device_tokens = DeviceTokensModel(({ title, message }) =>
    window.confirm(title + "\n\n" + message),
  );
  const start = () => {
    device_tokens.open.as(true);
    return Promise.all([
      model.methods.start(),
      device_tokens.refresh(),
      snapshots.methods.start(),
    ]);
  };
  const leave = () => {
    device_tokens.open.as(false);
    device_tokens.dispose();
    model.methods.leave();
    snapshots.methods.leave();
  };
  let stop_show, stop_hide;
  const content = View(
    {
      class: "box-border grid min-w-0 gap-space-4",
      attributes: {
        n: "settings-content",
        "aria-busy": computed(model.state.loading, String),
      },
      onMounted() {
        stop_show = view?.onShow(start);
        stop_hide = view?.onBeforeHide(leave);
        void start();
      },
      onUnmounted() {
        stop_show?.();
        stop_hide?.();
        leave();
        model.methods.destroy();
      },
    },
    [
      DeviceTokensView(device_tokens),
      View(
        {
          class: "box-border grid min-w-0 gap-space-3",
          attributes: { n: "settings-snapshots" },
        },
        [
          View({ as: "h2", class: "box-border m-0 text-sm" }, ["快照抓取"]),
          View({ class: "text-muted" }, [
            "默认每 1 小时抓取一次，单个订阅源可覆盖。公开源同时更新 XML 和广场预览；私密自有源按规则更新 XML，订阅访问仍需有效凭证，不发布文章预览。",
          ]),
          Show({
            when: snapshots.state.loading,
            ok: () =>
              View({ attributes: { role: "status" } }, ["正在加载抓取规则…"]),
          }),
          Show({
            when: snapshots.state.loaded,
            ok: () =>
              View({ class: "grid min-w-0 gap-space-3" }, [
                PollPolicyView(snapshots.editor, {
                  name: "settings-snapshot-policy",
                  disabled: snapshots.state.busy,
                }),
                Button(
                  {
                    class: "justify-self-start",
                    disabled: snapshots.state.busy,
                    attributes: { n: "settings-snapshot-save" },
                    onClick: snapshots.methods.save,
                  },
                  [
                    computed(snapshots.state.busy, (busy) =>
                      busy ? "正在保存…" : "保存抓取规则",
                    ),
                  ],
                ),
              ]),
          }),
          Show({
            when: computed(snapshots.state.error, Boolean),
            ok: () =>
              View({ class: "grid gap-space-2" }, [
                View({ class: "text-danger", attributes: { role: "alert" } }, [
                  snapshots.state.error,
                ]),
                Show({
                  when: computed(snapshots.state.loaded, (loaded) => !loaded),
                  ok: () =>
                    Button({ onClick: snapshots.methods.start }, [
                      "重新加载抓取规则",
                    ]),
                }),
              ]),
          }),
          View({ class: "text-muted", attributes: { role: "status" } }, [
            snapshots.state.message,
          ]),
        ],
      ),
      View(
        {
          as: "h2",
          class: "box-border m-0 text-sm",
          attributes: { n: "settings-model-heading" },
        },
        ["大模型"],
      ),
      View(
        {
          class: "box-border text-muted",
          attributes: { n: "settings-model-description" },
        },
        ["配置 XiaoxunAgent 使用的模型厂商、API Key 和模型参数。"],
      ),
      Show({
        when: model.state.loading,
        ok: () =>
          View(
            {
              class: "box-border text-muted",
              attributes: { n: "settings-loading", role: "status" },
            },
            ["正在加载大模型设置…"],
          ),
      }),
      Show({
        when: computed(model.state.error, Boolean),
        ok: () =>
          View(
            {
              class: "box-border grid gap-space-3",
              attributes: { n: "settings-load-failure" },
            },
            [
              View(
                {
                  class: "box-border text-danger",
                  attributes: { n: "settings-load-error", role: "alert" },
                },
                [model.state.error],
              ),
              Button(
                {
                  class: "box-border justify-self-start",
                  attributes: { n: "settings-retry-button" },
                  onClick: model.methods.start,
                },
                ["重新加载"],
              ),
            ],
          ),
      }),
      Show({
        when: model.state.loaded,
        ok: () =>
          AIPreferencesView({
            store: model.store,
            style: {
              height: "min(760px, 75dvh)",
              "min-height": "480px",
            },
          }),
      }),
      View(
        {
          class: "box-border text-muted",
          attributes: { n: "settings-message", role: "status" },
        },
        [model.store.state.settings_message],
      ),
    ],
  );
  return window.FindRSSAdminShell.Page({ page_id: "settings", title: "设置" }, [
    content,
  ]);
}

export { SettingsPage };
