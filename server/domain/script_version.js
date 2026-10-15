const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function ScriptVersionModel(version = "") {
  return Object.freeze({
    version,
    is_after(previous) {
      if (!previous) return true;
      if (!VERSION_PATTERN.test(previous)) return false;
      const current_parts = version.split(".").map(BigInt);
      const previous_parts = previous.split(".").map(BigInt);
      for (let index = 0; index < 3; index++) {
        if (current_parts[index] !== previous_parts[index]) return current_parts[index] > previous_parts[index];
      }
      return false;
    },
    toValue: () => ({ version }),
  });
}
ScriptVersionModel.of = ScriptVersionModel;
ScriptVersionModel.parse = (value, { required = false } = {}) => {
  const version = value === undefined ? "" : typeof value === "string" ? value.trim() : null;
  if (version === "" && !required) return { ok: true, model: ScriptVersionModel() };
  if (version === "") return { ok: false, error: { status: 400, message: "发布正式时必须指定版本号" } };
  if (version === null || version.length > 64 || !VERSION_PATTERN.test(version)) {
    return { ok: false, error: { status: 400, message: "版本号必须采用 1.0.0 格式，三段数字不得有多余的前导零" } };
  }
  return { ok: true, model: ScriptVersionModel(version) };
};
