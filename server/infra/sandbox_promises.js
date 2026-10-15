// 用 QuickJS Promise 桥接宿主异步函数：微任务中的调用不再触发同步 Asyncify 栈展开。
import { public_feed_failure } from "../lib/feed_error.js";

export function create_sandbox_promises(vm) {
  const pending = new Set();
  function bind(name, implementation) {
    return vm.newFunction(name, (...args) => {
      const deferred = vm.newPromise();
      // implementation 必须在第一次 await 前读完借用的参数 handle。
      let result;
      try { result = implementation(...args); } catch (failure) { result = Promise.reject(failure); }
      const task = Promise.resolve(result).then(
        (handle) => { try { deferred.resolve(handle); } finally { handle.dispose(); } },
        (failure) => {
          const error = vm.newError(failure instanceof Error ? failure.message : String(failure));
          const problem = public_feed_failure(failure);
          if (problem) {
            for (const [key, value] of Object.entries({ name: "FeedError", code: problem.code, message: problem.error })) {
              const handle = vm.newString(value);
              vm.setProp(error, key, handle);
              handle.dispose();
            }
          }
          const code = problem?.code ?? failure?.details?.code ?? failure?.code ?? failure?.status;
          if (typeof code === "string" || typeof code === "number") {
            const handle = typeof code === "number" ? vm.newNumber(code) : vm.newString(code);
            vm.setProp(error, "code", handle);
            handle.dispose();
          }
          try { deferred.reject(error); } finally { error.dispose(); }
        },
      ).finally(() => {
        pending.delete(task);
        deferred.dispose();
      });
      pending.add(task);
      return deferred.handle.dup();
    });
  }
  async function drain() {
    for (;;) {
      const jobs = vm.runtime.executePendingJobs();
      if (jobs.error) {
        const detail = vm.dump(jobs.error);
        jobs.error.dispose();
        throw new Error(detail?.message || String(detail));
      }
      if (pending.size > 0) { await Promise.race(pending); continue; }
      if (jobs.value === 0) break;
    }
  }
  return { bind, drain };
}
