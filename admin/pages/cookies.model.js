const Timeless = window.FindRSSAdminUI;
const { combine, ref, refarr } = Timeless;

async function request_json(url, options = {}) {
  const response = await window.FindRSSAdminAuth.fetch(url, {
    credentials: "same-origin", cache: "no-store", ...options,
    headers: options.body ? { "Content-Type": "application/json" } : {},
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败：HTTP " + response.status);
  return payload;
}

function CookiesViewModel() {
  const groups = refarr([]);
  const selected_domain = ref("");
  const busy = ref(false);
  const loaded = ref(false);
  const count = ref(0);
  const error = ref("");
  const message = ref("");
  const import_open = ref(false);
  const import_domain = ref("");
  const import_text = ref("");
  const import_error = ref("");

  function row_for(cookie) {
    return { id: JSON.stringify([cookie.name, cookie.path]), cookie, value: ref(cookie.value) };
  }

  function group_for(domain, cookies = []) {
    const group = groups.value.find(group => group.domain === domain) ||
      { domain, rows: refarr([]), new_name: ref(""), new_value: ref("") };
    const previous_rows = new Map(group.rows.value.map(row => [row.id, row]));
    group.rows.as(cookies.map(cookie => {
      const row = previous_rows.get(JSON.stringify([cookie.name, cookie.path])) || row_for(cookie);
      row.cookie = cookie;
      row.value.set(cookie.value);
      return row;
    }));
    group.new_name.set("");
    group.new_value.set("");
    return group;
  }

  function has_drafts() {
    return groups.value.some((group) =>
      group.new_name.value !== "" || group.new_value.value !== "" ||
      group.rows.value.some((row) => row.value.value !== row.cookie.value));
  }

  async function mutate(method, cookie, apply) {
    if (busy.value || !loaded.value) return;
    error.set("");
    message.set("");
    busy.set(true);
    try {
      const result = await request_json("/admin/api/cookies", { method, body: JSON.stringify(cookie) });
      apply(result.cookie);
      count.set(result.count);
      message.set(cookie.domain + " 的 " + cookie.name + (method === "DELETE" ? " 已删除。" : " 已保存。"));
    } catch (failure) {
      error.set(failure.message || String(failure));
    } finally {
      busy.set(false);
    }
  }

  const methods = {
    dismiss_notification() {
      message.set("");
      error.set("");
    },
    open_import() {
      if (busy.value || !loaded.value) return;
      import_domain.set(selected_domain.value);
      import_text.set("");
      import_error.set("");
      import_open.set(true);
    },
    close_import() {
      if (busy.value) return;
      import_open.set(false);
      import_text.set("");
      import_error.set("");
    },
    async import_cookies() {
      if (busy.value || !loaded.value) return;
      const domain = import_domain.value.trim().toLowerCase();
      const cookies = [];
      const names = new Set();
      import_error.set("");
      if (!domain || /[\s/]/.test(domain)) { import_error.set("请输入有效域名，如 .example.com"); return; }
      for (const part of import_text.value.split(";")) {
        const pair = part.trim();
        if (!pair) continue;
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (separator < 1 || !name || /[\s=\x00-\x1f\x7f]/.test(name) || /[\x00-\x1f\x7f]/.test(value)) {
          import_error.set("Cookie 格式不正确，请使用 key=value; k2=v2"); return;
        }
        if (names.has(name)) { import_error.set("Cookie key 重复，请每个 key 只填写一次"); return; }
        names.add(name);
        cookies.push({ domain, name, value, path: "/" });
      }
      if (!cookies.length) { import_error.set("请粘贴 Cookie 字符串"); return; }
      busy.set(true);
      error.set("");
      message.set("");
      let imported = 0;
      try {
        let group = groups.value.find(group => group.domain === domain);
        for (const cookie of cookies) {
          const row = group?.rows.value.find(row => row.cookie.name === cookie.name && row.cookie.path === "/");
          const result = await request_json("/admin/api/cookies", {
            method: row ? "PATCH" : "POST", body: JSON.stringify(cookie),
          });
          if (!group) {
            group = group_for(domain);
            groups.as([...groups.value, group]);
          }
          if (row) { row.cookie = result.cookie; row.value.set(result.cookie.value); }
          else group.rows.as([...group.rows.value, row_for(result.cookie)]);
          count.set(result.count);
          selected_domain.set(domain);
          imported++;
        }
        import_open.set(false);
        import_text.set("");
        message.set("已导入 " + imported + " 条 Cookie。");
      } catch (failure) {
        import_error.set("已导入 " + imported + " 条，导入中断：" + (failure.message || String(failure)) + "。可重试剩余条目。");
        import_text.set(cookies.slice(imported).map(cookie => cookie.name + "=" + cookie.value).join("; "));
      } finally {
        busy.set(false);
      }
    },
    select_domain(domain) {
      if (!busy.value && groups.value.some(group => group.domain === domain)) selected_domain.set(domain);
    },
    set_value(field, value) {
      if (!busy.value) field.set(String(value));
    },
    async refresh() {
      if (busy.value) return;
      if (has_drafts() && !window.confirm("重新读取会放弃未保存的 Cookie 修改，继续？")) return;
      busy.set(true);
      error.set("");
      message.set("正在读取 Cookie…");
      try {
        const result = await request_json("/admin/api/cookies");
        if (!Array.isArray(result.cookies)) throw new Error("Cookie 接口返回格式不正确");
        const by_domain = new Map();
        for (const cookie of result.cookies) {
          if (!by_domain.has(cookie.domain)) by_domain.set(cookie.domain, []);
          by_domain.get(cookie.domain).push(cookie);
        }
        groups.as([...by_domain].sort(([left], [right]) => left.localeCompare(right))
          .map(([domain, cookies]) => group_for(domain, cookies)));
        if (!groups.value.some(group => group.domain === selected_domain.value)) {
          selected_domain.set(groups.value[0]?.domain || "");
        }
        count.set(result.cookies.length);
        loaded.set(true);
        message.set("");
      } catch (failure) {
        error.set(failure.message || String(failure));
        message.set("");
      } finally {
        busy.set(false);
      }
    },
    save_cookie(row) {
      return mutate("PATCH", { domain: row.cookie.domain, name: row.cookie.name, path: row.cookie.path, value: row.value.value }, (cookie) => {
        row.cookie = cookie;
        row.value.set(cookie.value);
      });
    },
    remove_cookie(group, row) {
      return mutate("DELETE", { domain: row.cookie.domain, name: row.cookie.name, path: row.cookie.path }, () => {
        group.rows.as(group.rows.value.filter((item) => item.id !== row.id));
      });
    },
    async remove_domain(group) {
      if (busy.value || !loaded.value || !groups.value.includes(group)) return;
      error.set("");
      message.set("");
      busy.set(true);
      try {
        const result = await request_json("/admin/api/cookies/domain", {
          method: "DELETE", body: JSON.stringify({ domain: group.domain }),
        });
        groups.as(groups.value.filter(item => item.domain !== group.domain));
        if (selected_domain.value === group.domain) selected_domain.set(groups.value[0]?.domain || "");
        count.set(result.count);
        message.set(group.domain + " 及其所有 Cookie 已删除。");
      } catch (failure) {
        error.set(failure.message || String(failure));
      } finally {
        busy.set(false);
      }
    },
    add_cookie(group) {
      const name = group.new_name.value.trim();
      if (!name) { error.set("Cookie key 不能为空"); return; }
      return mutate("POST", { domain: group.domain, name, value: group.new_value.value, path: "/" }, (cookie) => {
        group.rows.as([...group.rows.value, row_for(cookie)]);
        group.new_name.set("");
        group.new_value.set("");
      });
    },
  };
  const selected_groups = combine({ groups, domain: selected_domain },
    ({ groups, domain }) => groups.filter(group => group.domain === domain));
  return { state: { groups, selected_domain, selected_groups, busy, loaded, count, error, message,
    import_open, import_domain, import_text, import_error }, methods };
}

export { CookiesViewModel };
