import { PaginationModel } from "../components/pagination.js";

const Timeless = window.FindRSSAdminUI;
const fetch = window.FindRSSAdminAuth.fetch;
const { combine, computed, ref, refarr, refobj } = Timeless;

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
  if (!response.ok) throw new Error(payload.error || "请求失败：HTTP " + response.status);
  return payload;
}

function datetime_to_timestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isSafeInteger(timestamp) ? timestamp : NaN;
}

function csv_cell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

const custom_code_pattern = /^[A-Z0-9]{8,32}$/;

/**
 * 解析自定义兑换码清单：每行「兑换码」或「兑换码,积分」（半角/全角逗号均可），
 * 不带积分的行继承活动默认积分。
 * @param {string} text @returns {{ cards: { code: string, credits: number | null }[] } | { error: string }}
 */
function parse_custom_codes_text(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { error: "请至少填写一个自定义兑换码" };
  if (lines.length > 1000) return { error: "自定义兑换码一次最多 1000 个" };
  const cards = [];
  const seen = new Set();
  for (const line of lines) {
    const separator = line.search(/[,，]/);
    const code_part = separator === -1 ? line : line.slice(0, separator);
    const credits_part = separator === -1 ? "" : line.slice(separator + 1).trim();
    const normalized = code_part.replace(/[\s-]/g, "").toUpperCase();
    if (!custom_code_pattern.test(normalized)) {
      return { error: "兑换码须为 8–32 位字母或数字（可含空格或连字符分组）：" + code_part.slice(0, 48) };
    }
    if (seen.has(normalized)) return { error: "兑换码重复：" + normalized };
    seen.add(normalized);
    let credits = null;
    if (credits_part !== "") {
      credits = Number(credits_part);
      if (!Number.isInteger(credits) || credits < 1 || credits > 10_000_000) {
        return { error: "兑换码「" + normalized + "」的积分须为 1–10000000 的整数" };
      }
    }
    cards.push({ code: normalized, credits });
  }
  return { cards };
}

function RedemptionCardsViewModel() {
  const campaigns_ = refarr([]);
  const cards_ = refarr([]);
  const campaign_page_ = ref(0);
  const campaign_page_size_ = ref(20);
  const campaign_total_count_ = ref(0);
  const card_page_ = ref(0);
  const card_page_size_ = ref(20);
  const card_total_count_ = ref(0);
  const selected_campaign_id_ = ref("");
  const loading_ = ref(false);
  const detail_loading_ = ref(false);
  const busy_ = ref(false);
  const error_ = ref("");
  const message_ = ref("");
  const draft_name_ = ref("");
  const draft_credits_ = ref("100");
  const draft_card_count_ = ref("10");
  const draft_starts_at_ = ref("");
  const draft_expires_at_ = ref("");
  const draft_custom_enabled_ = ref(false);
  const draft_custom_codes_ = ref("");
  const add_card_count_ = ref("10");
  const add_custom_enabled_ = ref(false);
  const add_custom_codes_ = ref("");
  const created_codes_ = refobj({ campaign_name: "", credits: 0, codes: [] });
  let detail_request_generation = 0;
  let campaign_request_generation = 0;

  async function load_campaigns(page = campaign_page_.value) {
    const generation = ++campaign_request_generation;
    const page_size = campaign_page_size_.value;
    loading_.set(true);
    error_.set("");
    try {
      page = Math.max(0, Math.floor(Number(page) || 0));
      const payload = await request_json(
        "/admin/api/redemption-campaigns?limit=" + page_size + "&offset=" + page * page_size,
      );
      if (generation !== campaign_request_generation) return;
      const total = Number(payload.total_count) || 0;
      const last_page = Math.max(0, Math.ceil(total / page_size) - 1);
      if (page > last_page) return await load_campaigns(last_page);
      campaign_page_.set(page);
      campaign_total_count_.set(total);
      campaigns_.as(Array.isArray(payload.campaigns) ? payload.campaigns : []);
      if (!campaigns_.value.some((campaign) => campaign.id === selected_campaign_id_.value)) {
        const next_id = campaigns_.value[0]?.id || "";
        if (next_id) await load_campaign(next_id, 0);
        else {
          selected_campaign_id_.set("");
          ++detail_request_generation;
          detail_loading_.set(false);
          card_page_.set(0);
          cards_.as([]);
          card_total_count_.set(0);
        }
      }
    } catch (failure) {
      if (generation !== campaign_request_generation) return;
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation === campaign_request_generation) loading_.set(false);
    }
  }

  async function load_campaign(campaign_id, page) {
    const generation = ++detail_request_generation;
    const page_size = card_page_size_.value;
    if (!campaign_id) {
      cards_.as([]);
      card_total_count_.set(0);
      detail_loading_.set(false);
      return;
    }
    const is_new_campaign = campaign_id !== selected_campaign_id_.value;
    selected_campaign_id_.set(campaign_id);
    const next_page = page === undefined
      ? is_new_campaign ? 0 : card_page_.value
      : Math.max(0, Math.floor(Number(page) || 0));
    detail_loading_.set(true);
    error_.set("");
    if (is_new_campaign) {
      card_page_.set(0);
      cards_.as([]);
      card_total_count_.set(0);
    }
    try {
      const payload = await request_json(
        "/admin/api/redemption-campaigns/" + encodeURIComponent(campaign_id) +
          "?limit=" + page_size + "&offset=" + next_page * page_size,
      );
      if (generation !== detail_request_generation) return;
      const total = Number(payload.total_card_count) || 0;
      const last_page = Math.max(0, Math.ceil(total / page_size) - 1);
      if (next_page > last_page) return await load_campaign(campaign_id, last_page);
      card_page_.set(next_page);
      cards_.as(Array.isArray(payload.cards) ? payload.cards : []);
      card_total_count_.set(total);
    } catch (failure) {
      if (generation !== detail_request_generation) return;
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation === detail_request_generation) detail_loading_.set(false);
    }
  }

  async function create_campaign() {
    const name = draft_name_.value.trim();
    const credits = Number(draft_credits_.value);
    const starts_at = datetime_to_timestamp(draft_starts_at_.value);
    const expires_at = datetime_to_timestamp(draft_expires_at_.value);
    let codes = null;
    if (draft_custom_enabled_.value) {
      const parsed = parse_custom_codes_text(draft_custom_codes_.value);
      if (parsed.error) {
        message_.set("");
        error_.set(parsed.error);
        return;
      }
      codes = parsed.cards;
    }
    const card_count = codes === null ? Number(draft_card_count_.value) : codes.length;
    error_.set("");
    message_.set("");
    if (!name) {
      error_.set("请填写活动名称");
      return;
    }
    if (!Number.isInteger(credits) || credits < 1 || credits > 10_000_000) {
      error_.set("每张卡的积分须为 1–10000000 的整数");
      return;
    }
    if (codes === null && (!Number.isInteger(card_count) || card_count < 1 || card_count > 1000)) {
      error_.set("卡片数量须为 1–1000 的整数");
      return;
    }
    if (Number.isNaN(starts_at) || Number.isNaN(expires_at)) {
      error_.set("开始时间或过期时间无效");
      return;
    }
    if (starts_at !== null && expires_at !== null && expires_at <= starts_at) {
      error_.set("过期时间必须晚于开始时间");
      return;
    }
    busy_.set(true);
    try {
      const payload = await request_json("/admin/api/redemption-campaigns", {
        method: "POST",
        body: JSON.stringify(
          codes === null ? { name, credits, card_count, starts_at, expires_at } : { name, credits, codes, starts_at, expires_at },
        ),
      });
      const created_codes = Array.isArray(payload.codes) ? payload.codes : [];
      created_codes_.as({ campaign_name: name, credits, codes: created_codes });
      campaign_page_.set(0);
      selected_campaign_id_.set(String(payload.campaign?.id || ""));
      draft_name_.set("");
      draft_custom_enabled_.set(false);
      draft_custom_codes_.set("");
      await load_campaigns();
      if (payload.campaign?.id) await load_campaign(String(payload.campaign.id));
      message_.set(codes === null
        ? "已生成 " + String(created_codes.length) + " 张兑换卡。请立即下载并妥善保管兑换码。"
        : "已创建 " + String(created_codes.length) + " 张自定义兑换卡。");
    } catch (failure) {
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      busy_.set(false);
    }
  }

  async function set_campaign_active(campaign) {
    error_.set("");
    try {
      await request_json("/admin/api/redemption-campaigns/" + encodeURIComponent(campaign.id), {
        method: "PATCH",
        body: JSON.stringify({ active: !campaign.active }),
      });
      await load_campaigns();
      await load_campaign(campaign.id);
    } catch (failure) {
      error_.set(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function create_cards() {
    const campaign = selected_campaign_.value;
    let codes = null;
    if (add_custom_enabled_.value) {
      const parsed = parse_custom_codes_text(add_custom_codes_.value);
      if (parsed.error) {
        message_.set("");
        error_.set(parsed.error);
        return;
      }
      codes = parsed.cards;
    }
    const card_count = codes === null ? Number(add_card_count_.value) : codes.length;
    error_.set("");
    message_.set("");
    if (!campaign || (codes === null && (!Number.isInteger(card_count) || card_count < 1 || card_count > 1000))) {
      error_.set("卡片数量须为 1–1000 的整数");
      return;
    }
    busy_.set(true);
    try {
      const payload = await request_json(
        "/admin/api/redemption-campaigns/" + encodeURIComponent(campaign.id) + "/cards",
        { method: "POST", body: JSON.stringify(codes === null ? { card_count } : { codes }) },
      );
      const created_codes = Array.isArray(payload.codes) ? payload.codes : [];
      created_codes_.as({ campaign_name: campaign.name, credits: campaign.credits, codes: created_codes });
      add_custom_enabled_.set(false);
      add_custom_codes_.set("");
      await load_campaigns();
      await load_campaign(campaign.id, 0);
      message_.set(codes === null
        ? "已在活动内生成 " + String(created_codes.length) + " 张兑换卡。请立即下载并妥善保管兑换码。"
        : "已在活动内创建 " + String(created_codes.length) + " 张自定义兑换卡。");
    } catch (failure) {
      error_.set(failure instanceof Error ? failure.message : String(failure));
    } finally {
      busy_.set(false);
    }
  }

  async function revoke_card(card_id) {
    const campaign_id = selected_campaign_id_.value;
    if (!campaign_id || !window.confirm("停用这张尚未兑换的卡？停用后无法恢复。")) return;
    error_.set("");
    try {
      await request_json(
        "/admin/api/redemption-campaigns/" + encodeURIComponent(campaign_id) +
          "/cards/" + encodeURIComponent(card_id) + "/revoke",
        { method: "POST", body: "{}" },
      );
      await load_campaigns();
      await load_campaign(campaign_id);
    } catch (failure) {
      error_.set(failure instanceof Error ? failure.message : String(failure));
    }
  }

  function download_codes() {
    const value = created_codes_.value;
    if (!value.codes.length) return;
    const lines = [
      ["活动名称", "每张积分", "兑换码"].map(csv_cell).join(","),
      ...value.codes.map((card) =>
        [value.campaign_name, card.credits ?? value.credits, card.code].map(csv_cell).join(","),
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const object_url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = object_url;
    anchor.download = "FindRSS-兑换卡-" + new Date().toISOString().slice(0, 10) + ".csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(object_url), 1000);
  }

  const selected_campaign_ = combine(
    { campaigns: campaigns_, selected_id: selected_campaign_id_ },
    (state) => state.campaigns.find((campaign) => campaign.id === state.selected_id) || null,
  );
  const campaign_pagination = PaginationModel(Timeless, { total: campaign_total_count_, page: campaign_page_,
    page_size: campaign_page_size_, loading: combine({ loading: loading_, busy: busy_ }, state => state.loading || state.busy),
    on_change: load_campaigns });
  const card_pagination = PaginationModel(Timeless, { total: card_total_count_, page: card_page_,
    page_size: card_page_size_, loading: combine({ loading: loading_, detail_loading: detail_loading_, busy: busy_ },
      state => state.loading || state.detail_loading || state.busy),
    on_change: page => load_campaign(selected_campaign_id_.value, page) });
  const page_label = state => (state.page + 1) + " / " + state.pages;
  const campaign_page_label_ = computed(campaign_pagination.state, page_label);
  const card_page_label_ = computed(card_pagination.state, page_label);

  return {
    campaign_pagination, card_pagination,
    state: {
      campaigns: campaigns_, cards: cards_, campaign_page: campaign_page_,
      campaign_total_count: campaign_total_count_, card_page: card_page_,
      card_total_count: card_total_count_, card_page_label: card_page_label_,
      campaign_page_label: campaign_page_label_, selected_campaign_id: selected_campaign_id_,
      selected_campaign: selected_campaign_, loading: loading_, busy: busy_, error: error_,
      message: message_, draft_name: draft_name_, draft_credits: draft_credits_,
      draft_card_count: draft_card_count_, draft_starts_at: draft_starts_at_,
      draft_expires_at: draft_expires_at_, draft_custom_enabled: draft_custom_enabled_,
      draft_custom_codes: draft_custom_codes_, add_card_count: add_card_count_,
      add_custom_enabled: add_custom_enabled_, add_custom_codes: add_custom_codes_,
      created_codes: created_codes_,
    },
    methods: {
      loadCampaigns: load_campaigns,
      loadCampaign: load_campaign,
      previousCampaignPage() { return campaign_pagination.set_page(campaign_page_.value - 1); },
      nextCampaignPage() { return campaign_pagination.set_page(campaign_page_.value + 1); },
      previousCardPage() { return card_pagination.set_page(card_page_.value - 1); },
      nextCardPage() { return card_pagination.set_page(card_page_.value + 1); },
      createCampaign: create_campaign,
      createCards: create_cards,
      setCampaignActive: set_campaign_active,
      revokeCard: revoke_card,
      downloadCodes: download_codes,
      clearCreatedCodes() {
        created_codes_.as({ campaign_name: "", credits: 0, codes: [] });
      },
      setDraft(field, value) {
        const fields = {
          name: draft_name_, credits: draft_credits_, card_count: draft_card_count_,
          starts_at: draft_starts_at_, expires_at: draft_expires_at_,
          custom_enabled: draft_custom_enabled_, custom_codes: draft_custom_codes_,
          add_card_count: add_card_count_,
          add_custom_enabled: add_custom_enabled_, add_custom_codes: add_custom_codes_,
        };
        fields[field]?.set(value);
      },
    },
  };
}

export { RedemptionCardsViewModel };
