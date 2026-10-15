// 注册用户实体。统一登录身份与管理端用户视图，密码哈希永不进入模型状态或对外值。
// 管理员是 ADMIN_PASSWORD 驱动的部署级认证主体，不属于本模型。

/**
 * users 行及其 user_credentials / access_tokens 聚合行。
 * 积分账本与行为日志是按 user_id / access token 关联的独立领域对象。
 * @param {Record<string, unknown>} [row]
 */
export function RegisteredUserModel(row) {
  const source = row ?? {};
  const email = source.email === null || source.email === undefined
    ? null
    : String(source.email);
  const email_verified_at = source.email_verified_at ?? null;
  const state = Object.freeze({
    id: String(source.id ?? ""),
    name: String(source.name ?? ""),
    email,
    email_verified_at,
    has_password: typeof source.password_hash === "string" && source.password_hash !== "",
    created_at: Number(source.created_at ?? 0),
    updated_at: Number(source.updated_at ?? 0),
    token_count: Number(source.token_count ?? 0),
    active_token_count: Number(source.active_token_count ?? 0),
    credit_balance: Number(source.credit_balance ?? 0),
    total_credits_used: Number(source.total_credits_used ?? 0),
    last_used_at: source.last_used_at ?? null,
  });
  const email_verified = state.email !== null && state.email_verified_at !== null;
  return Object.freeze({
    ...state,
    is_email_verified: () => email_verified,
    /** 阅读端只需要安全的身份三元组。 */
    toValue: () => ({ id: state.id, name: state.name, email: state.email }),
    admin_list_value: () => ({
      id: state.id,
      name: state.name,
      email: state.email,
      email_verified,
      email_verified_at: state.email_verified_at,
      created_at: state.created_at,
      updated_at: state.updated_at,
      token_count: state.token_count,
      active_token_count: state.active_token_count,
      credit_balance: state.credit_balance,
      total_credits_used: state.total_credits_used,
      last_used_at: state.last_used_at,
    }),
    admin_detail_value: () => ({
      id: state.id,
      name: state.name,
      email: state.email,
      email_verified,
      email_verified_at: state.email_verified_at,
      has_password: state.has_password,
      created_at: state.created_at,
      updated_at: state.updated_at,
    }),
  });
}

RegisteredUserModel.of = RegisteredUserModel;
RegisteredUserModel.fromRow = (row) => RegisteredUserModel(row);
/** @param {unknown} value */
RegisteredUserModel.normalize_email = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
/** @param {string} value */
RegisteredUserModel.valid_email = (value) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/** @param {string} value */
RegisteredUserModel.valid_password = (value) => value.length >= 8 && value.length <= 128;
/** 新用户默认名称取规范化邮箱的本地部分，上限与后台改名一致。 */
RegisteredUserModel.default_name = (value) => {
  const email = RegisteredUserModel.normalize_email(value);
  const at = email.indexOf("@");
  return (at === -1 ? email : email.slice(0, at)).slice(0, 128);
};
/** access_tokens JOIN 行里 `id` / `name` 属于 token，用户列有专用别名。 */
RegisteredUserModel.fromIdentityRow = (row) => RegisteredUserModel({
  id: row?.user_id,
  name: row?.user_name || row?.name || "Reader",
  email: row?.email,
});
