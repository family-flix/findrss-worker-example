const Timeless = window.FindRSSAdminUI;
const fetch = window.FindRSSAdminAuth.fetch;
const { ref, refarr, refobj } = Timeless;

const user_page_size = 20;

const activity_page_size = 50;

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

function UserActivityViewModel() {
  const search_text_ = ref("");
  const users_ = refarr([]);
  const users_loading_ = ref(false);
  const selected_user_id_ = ref("");
  const selected_user_ = refobj({ id: "", name: "", email: null });
  const kind_ = ref("credits");
  const rows_ = refarr([]);
  const cursor_ = ref("");
  const loading_ = ref(false);
  const more_loading_ = ref(false);
  const error_ = ref("");
  let users_generation = 0;
  let activity_generation = 0;

  async function load_users() {
    const my_generation = ++users_generation;
    users_loading_.set(true);
    error_.set("");
    try {
      const parameters = new URLSearchParams({
        limit: String(user_page_size),
        offset: "0",
      });
      const query = search_text_.value.trim();
      if (query !== "") parameters.set("q", query);
      const payload = await request_json("/admin/api/users?" + parameters.toString());
      if (my_generation !== users_generation) return;
      users_.as(Array.isArray(payload.users) ? payload.users : []);
    } catch (failure) {
      if (my_generation !== users_generation) return;
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (my_generation === users_generation) users_loading_.set(false);
    }
  }

  function select_user(user_id) {
    const id = String(user_id || "");
    if (id === "") return;
    const found = users_.value.find((user) => String(user.id) === id);
    selected_user_id_.set(id);
    selected_user_.as(found ? source_value(found) : { id, name: "", email: null });
    load_activity(true);
  }

  /** reset=true 从第一页重新拉；否则用游标续页。 */
  async function load_activity(reset) {
    const user_id = selected_user_id_.value;
    if (user_id === "") return;
    const cursor = reset ? "" : cursor_.value;
    if (!reset && cursor === "") return;
    if (loading_.value || more_loading_.value) return;
    const my_generation = ++activity_generation;
    if (reset) loading_.set(true);
    else more_loading_.set(true);
    error_.set("");
    try {
      const parameters = new URLSearchParams({
        kind: kind_.value,
        limit: String(activity_page_size),
      });
      if (cursor !== "") parameters.set("cursor", cursor);
      const payload = await request_json(
        "/admin/api/users/" + encodeURIComponent(user_id) + "/activity?" + parameters.toString(),
      );
      if (my_generation !== activity_generation) return;
      const values = kind_.value === "events" ? payload.events : payload.transactions;
      const list = Array.isArray(values) ? values : [];
      rows_.as(reset ? list : rows_.value.concat(list));
      cursor_.set(typeof payload.next_cursor === "string" ? payload.next_cursor : "");
    } catch (failure) {
      if (my_generation !== activity_generation) return;
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (my_generation === activity_generation) {
        loading_.set(false);
        more_loading_.set(false);
      }
    }
  }

  function set_kind(kind) {
    const next = kind === "events" ? "events" : "credits";
    if (next === kind_.value) return;
    kind_.set(next);
    load_activity(true);
  }

  return {
    state: {
      search_text: search_text_,
      users: users_,
      users_loading: users_loading_,
      selected_user_id: selected_user_id_,
      selected_user: selected_user_,
      kind: kind_,
      rows: rows_,
      cursor: cursor_,
      loading: loading_,
      more_loading: more_loading_,
      error: error_,
    },
    methods: {
      setSearchText(value) {
        search_text_.set(value);
      },
      search: load_users,
      selectUser: select_user,
      setKind: set_kind,
      loadActivity: load_activity,
      loadMore() {
        return load_activity(false);
      },
    },
  };
}

export { source_value, UserActivityViewModel };
