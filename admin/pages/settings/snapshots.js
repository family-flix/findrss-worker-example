import { SnapshotSettingsModel } from "../../components/snapshot_settings.model.js";
import { PollPolicyView } from "../../components/poll_policy.js";
import { SettingsSection } from "./section.js";
import { MAX_SNAPSHOT_CONCURRENCY } from "../../../server/lib/constants.js";

const { View, Button, Input, Show, computed } = window.FindRSSAdminUI;

function SettingsSnapshotsPage({ view, history } = {}) {
  const snapshots = SnapshotSettingsModel({ ui: window.FindRSSAdminUI });
  return SettingsSection({
    view, history, name: "settings-snapshots-content", loading: snapshots.state.loading, ...snapshots.methods,
  }, [
    View(
      {
        class: "box-border grid min-w-0 gap-space-3",
        attributes: { n: "settings-snapshots" },
      },
      [
        View({ as: "h2", class: "box-border m-0 text-sm", attributes: { n: "settings-fetch-title" } }, ["订阅源抓取"]),
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
              Input({
                label: "最大并发抓取数",
                value: snapshots.state.max_concurrency,
                disabled: snapshots.state.busy,
                help: "默认 4，范围 1 至 " + MAX_SNAPSHOT_CONCURRENCY + "。保存后用于自动抓取；调低时已开始的任务会继续完成。",
                attributes: { n: "settings-snapshot-concurrency", type: "number", min: 1, max: MAX_SNAPSHOT_CONCURRENCY, step: 1 },
                onInput: event => snapshots.methods.set_max_concurrency(event.target.value),
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
                    busy ? "正在保存…" : "保存抓取设置",
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
  ]);
}

export { SettingsSnapshotsPage };
