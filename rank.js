import { compile_script_module, execute_script } from "./server/infra/script_sandbox.js";
import { hot_scripts, HOT_SCRIPTS_VERSION } from "./rank/scripts.js";
import { create_rank_loader } from "./rank/loader.js";
import { create_rank_handler } from "./rank/http.js";
import { publish_rank_snapshots } from "./rank/snapshot.js";
import { read_rank_home } from "./rank/home.js";
import { submit_hot_snapshot } from "./server/service/worker/hot_snapshot.js";

export const handle_rank_request = create_rank_handler(read_rank_home, HOT_SCRIPTS_VERSION);
export function create_rank_snapshot_builder(execute_hot) {
  const load = create_rank_loader(hot_scripts, { compile: compile_script_module, execute: execute_script, execute_hot });
  return (env, signal) => publish_rank_snapshots(load, env, signal);
}
export async function enqueue_rank_snapshot(env) {
  const response = await submit_hot_snapshot(env);
  if (!response.ok) throw new Error("Hot 快照任务提交失败：HTTP " + response.status);
}
