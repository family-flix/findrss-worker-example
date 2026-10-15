// Curated Chat Completions presets, checked against official docs on 2026-10-02.
// Provider presets used by the admin model settings.
const catalog = [
  {
    id: "openai",
    name: "OpenAI",
    type: "openai_compat",
    base_url: "https://api.openai.com/v1",
    api_key_secret_name: "READER_AI_OPENAI",
    docs_url: "https://developers.openai.com/api/docs/models/",
    note: "预设为支持当前问答工具调用的 Chat Completions 模型。",
    models: [
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", model: "gpt-5.4-mini" },
      { id: "gpt-5.4", name: "GPT-5.4", model: "gpt-5.4" },
      { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", model: "gpt-5.4-nano" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic / Claude",
    type: "openai_compat",
    base_url: "https://api.anthropic.com/v1",
    api_key_secret_name: "READER_AI_ANTHROPIC",
    docs_url:
      "https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk",
    note: "使用 Anthropic 官方 OpenAI 兼容接口；推理深度由模型自动决定。",
    models: [
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        model: "claude-sonnet-5-5",
      },
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        model: "claude-opus-5-5",
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        model: "claude-haiku-4-5",
      },
    ],
  },
  {
    id: "gemini",
    name: "Google / Gemini",
    type: "openai_compat",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    api_key_secret_name: "READER_AI_GEMINI",
    docs_url: "https://ai.google.dev/gemini-api/docs/openai",
    note: "使用 Google 官方 OpenAI 兼容接口，密钥来自 Google AI Studio。",
    models: [
      {
        id: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash",
        model: "gemini-3.8-flash",
      },
      {
        id: "gemini-3.5-flash-lite",
        name: "Gemini 3.5 Flash-Lite",
        model: "gemini-3.5-flash-lite",
      },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro（预览）",
        model: "gemini-3.1-pro-preview",
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    type: "openai_compat",
    base_url: "https://api.deepseek.com",
    api_key_secret_name: "READER_AI_DEEPSEEK",
    docs_url: "https://api-docs.deepseek.com/quick_start/pricing-details-cny/",
    note: "采用当前官方模型 ID，可在模型配置中调整推理深度。",
    models: [
      { id: "deepseek-flash", name: "DeepSeek Flash", model: "deepseek-flash" },
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        model: "deepseek-v4-pro",
      },
    ],
  },
  {
    id: "qwen",
    name: "阿里云百炼 / 通义千问",
    type: "openai_compat",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key_secret_name: "READER_AI_QWEN",
    docs_url:
      "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
    note: "默认北京地域地址；可改为业务空间专属地址，密钥与地址需属于同一地域。",
    models: [
      { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", model: "qwen3.7-plus" },
      { id: "qwen3.8-max", name: "Qwen 3.8 Max", model: "qwen3.8-max" },
      { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", model: "qwen3.8-flash" },
    ],
  },
  {
    id: "moonshot",
    name: "月之暗面 / Kimi",
    type: "openai_compat",
    base_url: "https://api.moonshot.cn/v1",
    api_key_secret_name: "READER_AI_MOONSHOT",
    docs_url: "https://platform.kimi.com/docs/models",
    note: "默认国内开放平台地址；使用国际账号时可改为 https://api.moonshot.ai/v1。",
    models: [
      { id: "kimi-k3", name: "Kimi K3", model: "kimi-k3" },
      { id: "kimi-k2.6", name: "Kimi K2.6", model: "kimi-k2.6" },
      { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", model: "kimi-k2.7-code" },
    ],
  },
  {
    id: "zhipu",
    name: "智谱 / GLM",
    type: "openai_compat",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    api_key_secret_name: "READER_AI_ZHIPU",
    docs_url: "https://docs.bigmodel.cn/cn/guide/start/model-overview",
    note: "使用按量计费的开放平台接口，需开通对应模型。",
    models: [
      { id: "glm-5.3", name: "GLM 5.3", model: "glm-5.3" },
      { id: "glm-5.3-flash", name: "GLM 5.3 Flash", model: "glm-5.3-flash" },
    ],
  },
  {
    id: "volcengine",
    name: "火山引擎 / 豆包",
    type: "openai_compat",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    api_key_secret_name: "READER_AI_VOLCENGINE",
    docs_url: "https://docs.volcengine.com/docs/82379/1159178?lang=en",
    note: "需在火山方舟开通模型；使用自建推理接入点时，把模型 ID 换为控制台的 ep- ID。",
    models: [
      {
        id: "doubao-seed-2-0-lite",
        name: "Doubao Seed 2.0 Lite",
        model: "doubao-seed-2-0-lite-260428",
      },
      {
        id: "doubao-seed-2-0-mini",
        name: "Doubao Seed 2.0 Mini",
        model: "doubao-seed-2-0-mini-260428",
      },
      {
        id: "doubao-seed-2-0-pro",
        name: "Doubao Seed 2.0 Pro",
        model: "doubao-seed-2-0-pro-260215",
      },
    ],
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    type: "openai_compat",
    base_url: "https://api.siliconflow.cn/v1",
    api_key_secret_name: "READER_AI_SILICONFLOW",
    docs_url: "https://docs.siliconflow.cn/docs/api/chat-completions-post",
    note: "使用国内平台地址，模型权限与计费以硅基流动账号为准。",
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        model: "deepseek-ai/DeepSeek-V4-Flash",
      },
      {
        id: "kimi-k2.7-code",
        name: "Kimi K2.7 Code",
        model: "moonshotai/Kimi-K2.7-Code",
      },
      { id: "glm-5.2", name: "GLM 5.2 Pro", model: "Pro/zai-org/GLM-5.2" },
    ],
  },
];

export const AI_PROVIDER_PRESETS = Object.freeze(
  catalog.map((provider) =>
    Object.freeze({
      ...provider,
      models: Object.freeze(
        provider.models.map((model) => Object.freeze(model)),
      ),
    }),
  ),
);

export function ai_provider_preset(id) {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) || null;
}

// New mutable values every time; editing a draft must never mutate the built-in catalog.
export function create_ai_provider_preset(id) {
  const preset = ai_provider_preset(id);
  if (!preset) return null;
  return {
    id: `preset-${preset.id}`,
    preset_id: preset.id,
    name: preset.name,
    type: preset.type,
    enabled: true,
    base_url: preset.base_url,
    api_key_secret_name: preset.api_key_secret_name,
    models: preset.models.map((model) => ({
      ...model,
      enabled: true,
      options: {},
    })),
  };
}

// Only fill missing models. Preserve endpoints, credentials, options and role references.
export function add_ai_preset(providers, preset_id, limit = 16) {
  const added = create_ai_provider_preset(preset_id);
  if (!added) return providers;
  const existing =
    providers.find(
      (provider) =>
        provider.preset_id === preset_id && provider.type === added.type,
    );
  if (!existing) {
    if (
      providers.length >= limit ||
      providers.some((provider) => provider.id === added.id)
    )
      return providers;
    return [...providers, added];
  }
  return providers.map((provider) => {
    if (provider.id !== existing.id) return provider;
    const models = [...provider.models];
    for (const model of added.models) {
      if (models.length >= 32) break;
      if (models.some((entry) => entry.model === model.model)) continue;
      let id = model.id;
      let suffix = 1;
      while (models.some((entry) => entry.id === id))
        id = `${model.id}-${suffix++}`;
      models.push({ ...model, id });
    }
    return { ...provider, preset_id, models };
  });
}

// Populate missing built-ins for new and upgraded accounts; retain explicit user overrides.
export function ensure_ai_presets(providers) {
  let result = providers.filter(provider => provider.type === "openai_compat");
  for (const preset of AI_PROVIDER_PRESETS) {
    const exists = result.some(provider => provider.preset_id === preset.id && provider.type === preset.type);
    if (!exists) result = add_ai_preset(result, preset.id);
  }
  return result;
}
