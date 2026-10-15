/**
 * 脚本 route.path 的编译与匹配。
 *
 * 支持的子集：静态段、`:name`、`:name{regexp}`，以及以 `?` 结尾的可选参数。
 * 构造时对非法 path 抛错（保存/编译校验路径依赖这个行为）；
 * `RssRoutePatternModel.fromValue` 是容错版本，坏 path 返回 null（读取路径用它，
 * 一行坏 metadata 不该让整个列表 500）。
 *
 * 纯模块，可在 node --test 下直接覆盖。
 */

/**
 * @param {string} path
 * @returns {{ regexp: RegExp, parameter_names: string[], score: number }}
 */
function compile_path(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 256) {
    throw new Error("route.path 必须是以 / 开头且不超过 256 字符的字符串");
  }
  const parameter_names = [];
  let expression = "^";
  let score = 0;
  const segments = path.split("/").slice(1);
  if (segments.length === 1 && segments[0] === "") {
    expression += "/";
  } else {
    for (let segment_index = 0; segment_index < segments.length; segment_index += 1) {
      const segment = segments[segment_index];
      const parameter = /^:([A-Za-z_][A-Za-z0-9_]*)(?:\{([\s\S]+)\})?(\?)?$/.exec(segment);
      if (parameter === null) {
        if (segment.includes("?")) {
          throw new Error("route.path 不应包含 query string");
        }
        expression += "/" + segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        score += 100 + segment.length;
        continue;
      }
      const name = parameter[1];
      if (parameter_names.includes(name)) {
        throw new Error("route.path 参数名重复：" + name);
      }
      const pattern = parameter[2] || "[^/]+";
      const optional = parameter[3] === "?";
      const group_name = "findrss_" + parameter_names.length;
      if (optional && segment_index === 0 && segments.length === 1) {
        expression += `/(?<${group_name}>${pattern})?`;
      } else {
        expression += optional
          ? `(?:/(?<${group_name}>${pattern}))?`
          : `/(?<${group_name}>${pattern})`;
      }
      parameter_names.push(name);
      score += optional ? 1 : 10;
    }
  }
  let regexp;
  try {
    regexp = new RegExp(expression + "$", "u");
  } catch (failure) {
    throw new Error(
      "route.path 正则无效：" + (failure instanceof Error ? failure.message : String(failure)),
    );
  }
  return { regexp, parameter_names, score };
}

/** @param {ReturnType<typeof compile_path>} compiled @param {string} pathname */
function match_compiled(compiled, pathname) {
  let decoded_pathname;
  try {
    decoded_pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const match = compiled.regexp.exec(decoded_pathname);
  if (match === null) return null;
  /** @type {Record<string, string>} */
  const params = Object.create(null);
  for (let index = 0; index < compiled.parameter_names.length; index += 1) {
    params[compiled.parameter_names[index]] = match.groups?.["findrss_" + index] ?? "";
  }
  return { params, score: compiled.score };
}

/**
 * route.path 模式实体。非法 path 在构造时抛错。
 * @param {string} path
 */
export function RssRoutePatternModel(path) {
  const compiled = compile_path(path);
  const state = Object.freeze({
    path: String(path),
    parameter_names: Object.freeze([...compiled.parameter_names]),
    /** 特异性得分，越大越优先；路由选择按它排序。 */
    score: compiled.score,
  });
  return Object.freeze({
    ...state,
    /**
     * 用编译好的模式匹配一个 pathname。
     * @param {string} pathname
     * @returns {{ params: Record<string, string>, score: number } | null}
     */
    match: (pathname) => match_compiled(compiled, pathname),
    toValue: () => ({ path: state.path, parameter_names: [...state.parameter_names], score: state.score }),
  });
}

RssRoutePatternModel.of = RssRoutePatternModel;
/** 容错构造：非法 path 返回 null，绝不抛错。 */
RssRoutePatternModel.fromValue = (path) => {
  try {
    return RssRoutePatternModel(path);
  } catch {
    return null;
  }
};
