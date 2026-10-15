// 设备容量与调度（device pool）。
//
// `DeviceModel` 是调度候选的实体视图：把 websocket 候选附件归一成稳定的
// `device_id` + `max_concurrency`，同时**原样保留** `socket` / `attachment`，
// 让 `DevicePoolModel.pick()` 的调用方仍能解构出这两项（它们要拿 socket 下发票据、
// 拿 attachment 记日志）。设备声明的能力清单（`methods_json`）也挂在这里，
// 因为那是 `devices` 表的列，不是 access_tokens 的。
//
// 纯模块，可在 node --test 下直接覆盖。

const DEFAULT_DEVICE_CONCURRENCY = 1;
// 设备自报并发的硬顶。原来 64 对应的是「探针的取证通道全开、单次调用 ~290ms、
// 吞吐恒定 ~3.4 次/秒」那个时代 —— 那时候调高它没用，因为瓶颈不在调度。
// 取证关掉之后瓶颈回到「并发数 ÷ 单次往返」，这个上限就成了**真正卡住吞吐的那一个**：
// 5000 源 / 60 秒需要 ~83 次/秒，按 ~2 秒往返要 ~167 路在飞。
// 256 是给实测留的余量，不是目标值；实测出拐点后应当回调到拐点附近。
const MAX_DEVICE_CONCURRENCY = 256;

/**
 * 归一设备并发度：非法/越界回退到 fallback，上限 MAX_DEVICE_CONCURRENCY。
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function normalize_concurrency(value, fallback = DEFAULT_DEVICE_CONCURRENCY) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1
    ? Math.min(parsed, MAX_DEVICE_CONCURRENCY)
    : fallback;
}

/**
 * 调度候选设备实体。`socket`/`attachment` 是调度上下文，原样带过。
 * @param {{ device_id?: unknown, max_concurrency?: unknown, socket?: unknown, attachment?: unknown }} [candidate]
 */
export function DeviceModel(candidate) {
  const source = candidate ?? {};
  const state = Object.freeze({
    device_id: String(source.device_id ?? ""),
    max_concurrency: normalize_concurrency(source.max_concurrency),
    socket: source.socket,
    attachment: source.attachment,
  });
  return Object.freeze({
    ...state,
    /**
     * 该设备在给定活跃数下的负载率（active / max_concurrency）。
     * @param {number} active
     * @returns {number}
     */
    load: (active) => Number(active) / state.max_concurrency,
    toValue: () => ({
      device_id: state.device_id,
      max_concurrency: state.max_concurrency,
    }),
  });
}

DeviceModel.DEFAULT_CONCURRENCY = DEFAULT_DEVICE_CONCURRENCY;
DeviceModel.MAX_CONCURRENCY = MAX_DEVICE_CONCURRENCY;
/** 设备名的字符上限。 */
DeviceModel.NAME_MAX_LENGTH = 128;
DeviceModel.of = DeviceModel;
/** 从 `devices` 行构造。 */
DeviceModel.fromRow = (row) => DeviceModel(row);
DeviceModel.normalize_concurrency = normalize_concurrency;
/**
 * 设备声明的能力清单（`devices.methods_json`），非字符串项直接丢弃。
 * @param {string} value
 * @returns {string[]}
 */
DeviceModel.parse_methods = (value) => {
  try {
    const methods = JSON.parse(value);
    return Array.isArray(methods)
      ? methods.filter((method) => typeof method === "string")
      : [];
  } catch {
    return [];
  }
};
/**
 * 设备是否提供某个方法。既接受 `methods_json` 字符串，也接受已解析的数组
 * （外层 worker 的 `do_proxy` 用的是数组形状）。
 * @param {unknown} methods
 * @param {unknown} method
 * @returns {boolean}
 */
DeviceModel.supports = (methods, method) => {
  const list = Array.isArray(methods) ? methods : DeviceModel.parse_methods(methods);
  return list.includes(String(method));
};
/**
 * 设备是否被管理员禁用。
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {boolean}
 */
DeviceModel.is_disabled = (row) => Number(row?.disabled) === 1;
/**
 * 归一设备名：去空白、截断到上限、空则回落到设备 ID。
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
DeviceModel.truncate_name = (value, fallback = "") =>
  String(value ?? "").trim().slice(0, DeviceModel.NAME_MAX_LENGTH) || fallback;

/**
 * 从仍有空槽的设备中选负载率最低者。
 * @param {ReadonlyArray<ReturnType<typeof DeviceModel>>} devices
 * @param {Map<string, number>} active_counts
 * @returns {ReturnType<typeof DeviceModel> | null}
 */
function pick_device(devices, active_counts) {
  let selected = null;
  let selected_active = 0;
  for (const device of devices) {
    const active = active_counts.get(device.device_id) ?? 0;
    if (active >= device.max_concurrency) continue;
    if (
      selected === null ||
      active * selected.max_concurrency < selected_active * device.max_concurrency ||
      (active * selected.max_concurrency === selected_active * device.max_concurrency &&
        device.device_id < selected.device_id)
    ) {
      selected = device;
      selected_active = active;
    }
  }
  return selected;
}

/**
 * 候选设备池。`pick()` 返回负载率最低且仍有空槽的 `DeviceModel`，无可用设备时返回 null。
 * @param {Array<Record<string, unknown>>} [candidates]
 * @param {Map<string, number>} [active_counts]
 */
export function DevicePoolModel(candidates, active_counts) {
  const devices = Object.freeze(
    (Array.isArray(candidates) ? candidates : []).map((candidate) => DeviceModel(candidate)),
  );
  const counts = active_counts instanceof Map ? active_counts : new Map();
  return Object.freeze({
    devices,
    pick: () => pick_device(devices, counts),
    toValue: () => devices.map((device) => device.toValue()),
  });
}

DevicePoolModel.of = DevicePoolModel;
/**
 * 当前还能接多少任务：每台设备 `max_concurrency - active` 的余量之和（负余量按 0）。
 * @param {ReadonlyArray<{ device_id?: unknown, max_concurrency?: unknown }>} attachments
 * @param {Map<string, number>} active_counts
 * @returns {number}
 */
DevicePoolModel.available_slots = (attachments, active_counts) =>
  (Array.isArray(attachments) ? attachments : []).reduce((total, attachment) => {
    const device = DeviceModel(attachment);
    const active = active_counts.get(device.device_id) ?? 0;
    return total + Math.max(0, device.max_concurrency - active);
  }, 0);
