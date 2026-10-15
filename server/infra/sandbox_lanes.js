// 沙箱执行的并发泳道池：把任务分派到若干条串行链上，按需创建到上限。
//
// 用途：QuickJS 的 asyncify 变体在同一 wasm 实例内同时只允许一个异步动作，
// 而一次脚本执行里最长的一步是 30s 的 ctx.invoke 设备调用。原先所有执行
// （含编译校验）共用**一条** Promise 链，于是整条链的吞吐 = 一台设备串行跑完所有 key：
// 实测 1/4/8/16 台设备的总时长恒为 27s，132 个任务全部落在同一台设备上
// （任何时刻只有一条任务在飞，调度永远挑 device_id 最小的那台）。
//
// 但这条链是过度保守的：script_sandbox.get_quickjs_module() 每次执行都全新
// instantiate（Asyncify 的栈展开状态挂在 Emscripten 模块全局上，跨请求复用会损坏），
// 执行之间**没有共享的可变状态**，所以并发是安全的。并发度 = 泳道数。
//
// 泳道**惰性增长**到 max_lanes：启动时不预建，只在「没有空闲泳道」时才新建一条，
// 所以串行场景（低并发、或同 key 合并后只剩少量执行）始终只有 1 条；上限的作用是
// 兜住内存（每个泳道 = 一个在飞的 wasm 实例，各占一份内存，而 isolate 只有 128MB）。
// 用满之后新任务挂到**最浅**的那条泳道，而不是排在最忙的那条后面，避免队头阻塞。
// 纯模块，可在 node --test 下直接覆盖。

export class SandboxLanePool {
  /** @param {number} max_lanes 泳道上限（= 同时在飞的 wasm 实例数上限） */
  constructor(max_lanes) {
    this.max_lanes = max_lanes;
    /** @type {number[]} 空闲泳道的下标，LIFO 复用，让单设备时只热一条。 */
    this.idle = [];
    /** @type {Promise<void>[]} 每条泳道的链尾；空闲时是已 resolve 的 promise。 */
    this.tails = [];
    /** @type {number[]} 每条泳道排队中的任务数，用来挑最浅的一条。 */
    this.depths = [];
  }

  /** 已创建的泳道数（惰性增长，不会超过 max_lanes）。 */
  get lane_count() {
    return this.tails.length;
  }

  /** 在飞 + 排队中的任务数。 */
  get inflight() {
    let total = 0;
    for (const depth of this.depths) total += depth;
    return total;
  }

  /**
   * 排队执行任务；同一个泳道上的任务严格串行，不同泳道之间并发。
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   * @template T
   */
  run(task) {
    const lane = this.acquire_lane();
    this.depths[lane] += 1;
    const done = this.tails[lane].then(task, task);
    // 挂到链尾的是「已消化结果」的版本，否则一次失败会顺着链把后续任务全带崩。
    const release = () => {
      this.release_lane(lane);
    };
    this.tails[lane] = done.then(release, release);
    return done;
  }

  /** @returns {number} 可用泳道：优先复用空闲的，其次新建，最后挑最浅的。 */
  acquire_lane() {
    const idle = this.idle.pop();
    if (idle !== undefined) return idle;
    if (this.tails.length < this.max_lanes) {
      this.tails.push(Promise.resolve());
      this.depths.push(0);
      return this.tails.length - 1;
    }
    let shallowest = 0;
    for (let index = 1; index < this.depths.length; index += 1) {
      if (this.depths[index] < this.depths[shallowest]) shallowest = index;
    }
    return shallowest;
  }

  /** @param {number} lane */
  release_lane(lane) {
    this.depths[lane] -= 1;
    if (this.depths[lane] === 0) this.idle.push(lane);
  }
}
