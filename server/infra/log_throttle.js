// 失败日志的时间窗去重闸门：同一个键在一个窗口内最多放行一次。
//
// 用途：冷缓存 + 高并发时，「设备还没做完」会让成百上千个**同键**请求同时失败，
// 逐个写 script_logs 既是重复劳动（同一相位、同一原因），也会把日志表写爆。
// 时间由调用方注入，纯模块，可在 node --test 下直接覆盖。

export class LogThrottle {
  /**
   * @param {number} window_ms 同一个键的静默窗口
   * @param {number} max_keys 键上限；超出时淘汰最久未放行的键，避免无界增长
   */
  constructor(window_ms, max_keys = 1024) {
    this.window_ms = window_ms;
    this.max_keys = max_keys;
    /** @type {Map<string, number>} key → 上次放行的时间戳，迭代序即放行序 */
    this.allowed_at = new Map();
  }

  /**
   * 是否放行本次记录（放行会顺便刷新该键的时间戳）。
   * @param {string} key
   * @param {number} now
   * @returns {boolean}
   */
  allow(key, now) {
    const last = this.allowed_at.get(key);
    if (last !== undefined && now - last < this.window_ms) return false;
    // 删了再插 = 挪到 Map 尾部（最近放行），配合下面的淘汰让最旧键先出局。
    this.allowed_at.delete(key);
    this.allowed_at.set(key, now);
    while (this.allowed_at.size > this.max_keys) {
      const oldest = this.allowed_at.keys().next();
      if (oldest.done) break;
      this.allowed_at.delete(oldest.value);
    }
    return true;
  }
}
