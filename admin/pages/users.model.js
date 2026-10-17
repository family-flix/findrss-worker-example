import { PaginationModel } from "../components/pagination.js";

const Timeless = window.FindRSSAdminUI;
const fetch = window.FindRSSAdminAuth.fetch;
const { ref, refarr, refobj } = Timeless;

function source_value(value) {
  return value && value.__is_ref ? value.value : value;
}

async function request_json(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败：HTTP " + response.status);
  }
  return payload;
}

function UsersViewModel() {
  const users_ = refarr([]);
  const page_ = ref(0);
  const page_size_ = ref(20);
  const total_count_ = ref(0);
  const loading_ = ref(false);
  const error_ = ref("");
  const message_ = ref("");
  const query_ = ref("");
  const search_text_ = ref("");
  const expanded_user_id_ = ref("");
  const detail_loading_ = ref(false);
  const detail_user_ = refobj({});
  const detail_tokens_ = refarr([]);
  const edit_ = refobj({ saving: false, error: "", name: "", email: "" });
  const reset_ = refobj({ saving: false, error: "", password: "" });
  const busy_user_id_ = ref("");
  const busy_action_ = ref("");
  let generation = 0;

  async function load_users(page) {
    const current =
      page === undefined
        ? page_.value
        : Math.max(0, Math.floor(Number(page) || 0));
    const my_generation = ++generation;
    const page_size = page_size_.value;
    loading_.set(true);
    error_.set("");
    try {
      const parameters = new URLSearchParams({
        limit: String(page_size),
        offset: String(current * page_size),
      });
      const query = query_.value;
      if (query !== "") parameters.set("q", query);
      const payload = await request_json(
        "/admin/api/users?" + parameters.toString(),
      );
      if (my_generation !== generation) return;
      const total = Number(payload.total_count) || 0;
      const last_page = Math.max(0, Math.ceil(total / page_size) - 1);
      if (current > last_page) return await load_users(last_page);
      page_.set(current);
      total_count_.set(total);
      users_.as(Array.isArray(payload.users) ? payload.users : []);
      if (
        expanded_user_id_.value !== "" &&
        !users_.value.some((user) => user.id === expanded_user_id_.value)
      ) {
        expanded_user_id_.set("");
        detail_user_.as({});
        detail_tokens_.as([]);
      }
    } catch (failure) {
      if (my_generation !== generation) return;
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (my_generation === generation) loading_.set(false);
    }
  }

  async function load_detail(user_id) {
    if (!user_id) return;
    if (expanded_user_id_.value === user_id) {
      expanded_user_id_.set("");
      detail_user_.as({});
      detail_tokens_.as([]);
      return;
    }
    expanded_user_id_.set(user_id);
    detail_loading_.set(true);
    detail_user_.as({});
    detail_tokens_.as([]);
    edit_.as({ saving: false, error: "", name: "", email: "" });
    reset_.as({ saving: false, error: "", password: "" });
    error_.set("");
    try {
      const payload = await request_json(
        "/admin/api/users/" + encodeURIComponent(user_id),
      );
      const user = payload.user || {};
      detail_user_.as(user);
      detail_tokens_.as(
        Array.isArray(payload.access_tokens) ? payload.access_tokens : [],
      );
      edit_.as({
        saving: false,
        error: "",
        name: String(user.name || ""),
        email: String(user.email || ""),
      });
    } catch (failure) {
      expanded_user_id_.set("");
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      detail_loading_.set(false);
    }
  }

  async function refresh_detail() {
    const user_id = expanded_user_id_.value;
    if (!user_id) return;
    await load_users(page_.value);
    if (expanded_user_id_.value !== user_id) return;
    try {
      const payload = await request_json(
        "/admin/api/users/" + encodeURIComponent(user_id),
      );
      detail_user_.as(payload.user || {});
      detail_tokens_.as(
        Array.isArray(payload.access_tokens) ? payload.access_tokens : [],
      );
    } catch (failure) {
      error_.set(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function set_edit_field(field, value) {
    edit_.as({ ...edit_.value, [field]: value, error: "" });
  }

  async function save_edit() {
    const user_id = expanded_user_id_.value;
    const name = edit_.value.name.trim();
    const email = edit_.value.email.trim().toLowerCase();
    if (!name) {
      edit_.as({ ...edit_.value, error: "名称不能为空" });
      return;
    }
    if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      edit_.as({ ...edit_.value, error: "请输入合法的邮箱地址" });
      return;
    }
    edit_.as({ ...edit_.value, saving: true, error: "" });
    try {
      const body = { name };
      if (email !== String(source_value(detail_user_.value).email || "")) {
        body.email = email === "" ? null : email;
      }
      const payload = await request_json(
        "/admin/api/users/" + encodeURIComponent(user_id),
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      detail_user_.as(payload.user || {});
      detail_tokens_.as(
        Array.isArray(payload.access_tokens) ? payload.access_tokens : [],
      );
      edit_.as({ ...edit_.value, saving: false, error: "" });
      message_.set("用户资料已更新");
      await load_users(page_.value);
    } catch (failure) {
      edit_.as({
        ...edit_.value,
        saving: false,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }

  function set_reset_field(value) {
    reset_.as({ saving: false, error: "", password: value });
  }

  async function reset_password() {
    const user_id = expanded_user_id_.value;
    const password = reset_.value.password;
    if (password.length < 8 || password.length > 128) {
      reset_.as({ ...reset_.value, error: "密码长度必须为 8–128 个字符" });
      return;
    }
    reset_.as({ ...reset_.value, saving: true, error: "" });
    try {
      const payload = await request_json(
        "/admin/api/users/" + encodeURIComponent(user_id) + "/reset-password",
        { method: "POST", body: JSON.stringify({ password }) },
      );
      detail_user_.as(payload.user || {});
      detail_tokens_.as(
        Array.isArray(payload.access_tokens) ? payload.access_tokens : [],
      );
      reset_.as({ saving: false, error: "", password: "" });
      message_.set("密码已重置");
      await load_users(page_.value);
    } catch (failure) {
      reset_.as({
        ...reset_.value,
        saving: false,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }

  async function verify_email() {
    const user_id = expanded_user_id_.value;
    begin_busy(user_id, "verify");
    try {
      const payload = await request_json(
        "/admin/api/users/" + encodeURIComponent(user_id) + "/verify-email",
        { method: "POST", body: "{}" },
      );
      detail_user_.as(payload.user || {});
      detail_tokens_.as(
        Array.isArray(payload.access_tokens) ? payload.access_tokens : [],
      );
      message_.set("邮箱已标记为已验证");
      await load_users(page_.value);
    } catch (failure) {
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      end_busy();
    }
  }

  function begin_busy(user_id, action) {
    busy_user_id_.set(user_id);
    busy_action_.set(action);
  }

  function end_busy() {
    busy_user_id_.set("");
    busy_action_.set("");
  }

  async function confirm_delete(user_id) {
    if (busy_action_.value) return;
    begin_busy(user_id, "delete");
    try {
      await request_json("/admin/api/users/" + encodeURIComponent(user_id), {
        method: "DELETE",
      });
      message_.set("用户已删除");
      if (expanded_user_id_.value === user_id) {
        expanded_user_id_.set("");
        detail_user_.as({});
        detail_tokens_.as([]);
      }
      const previous = page_.value;
      await load_users(previous);
    } catch (failure) {
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      end_busy();
    }
  }

  function search() {
    query_.set(search_text_.value.trim());
    return load_users(0);
  }

  const pagination = PaginationModel(Timeless, {
    total: total_count_,
    page: page_,
    page_size: page_size_,
    loading: loading_,
    on_change: load_users,
  });

  return {
    pagination,
    state: {
      users: users_,
      loading: loading_,
      error: error_,
      message: message_,
      page: page_,
      total_count: total_count_,
      query: query_,
      search_text: search_text_,
      expanded_user_id: expanded_user_id_,
      detail_loading: detail_loading_,
      detail_user: detail_user_,
      detail_tokens: detail_tokens_,
      edit: edit_,
      reset: reset_,
      busy_user_id: busy_user_id_,
      busy_action: busy_action_,
    },
    methods: {
      loadUsers: load_users,
      loadDetail: load_detail,
      refreshDetail: refresh_detail,
      setEditField: set_edit_field,
      saveEdit: save_edit,
      setResetField: set_reset_field,
      resetPassword: reset_password,
      verifyEmail: verify_email,
      confirmDelete: confirm_delete,
      setSearchText(value) {
        search_text_.set(value);
      },
      search,
      nextPage() {
        return pagination.set_page(page_.value + 1);
      },
      prevPage() {
        return pagination.set_page(page_.value - 1);
      },
    },
  };
}

export { source_value, UsersViewModel };
