import { AI_PROVIDER_PRESETS } from "./ai_presets.js";

const logos = Object.freeze({
  workers_ai: "workersai-color",
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini-color",
  deepseek: "deepseek-color",
  qwen: "qwen-color",
  moonshot: "moonshot",
  zhipu: "zhipu-color",
  volcengine: "volcengine-color",
  siliconflow: "siliconcloud-color",
});
const aliases = Object.freeze({ cloudflare: "workers_ai", workersai: "workers_ai", claude: "anthropic", google: "gemini", bailian: "qwen", kimi: "moonshot", glm: "zhipu", doubao: "volcengine", siliconcloud: "siliconflow" });
const hosts = new Map(AI_PROVIDER_PRESETS.filter(preset => preset.base_url).map(preset => [new URL(preset.base_url).hostname, preset.id]));
hosts.set("api.moonshot.ai", "moonshot");
hosts.set("api.siliconflow.com", "siliconflow");
hosts.set("dashscope-intl.aliyuncs.com", "qwen");
hosts.set("dashscope-us.aliyuncs.com", "qwen");

function AIProviderLogoModel(value = {}) {
  const provider = value?.provider || value || {};
  const preset_id = value?.preset_id || provider.preset_id;
  let brand = Object.hasOwn(logos, preset_id || "") ? preset_id : "";
  if (!brand && provider.type === "workers_ai") brand = "workers_ai";
  if (!brand) {
    // 对自定义端点只匹配完整主机名，兼容协议本身不能说明厂商身份。
    try { brand = hosts.get(new URL(provider.base_url).hostname) || ""; } catch {}
  }
  if (!brand) {
    const id = String(provider.id || "").replace(/^preset[-:]/, "").toLowerCase();
    brand = Object.hasOwn(logos, id) ? id : Object.hasOwn(aliases, id) ? aliases[id] : "";
  }
  const asset = logos[brand] || "";
  const src = asset ? `/provider-logos/${asset}.svg` : "";
  const monochrome = Boolean(asset && !asset.endsWith("-color"));
  const initial = Array.from(String(provider.name || value?.name || "?").trim())[0]?.toUpperCase() || "?";
  return Object.freeze({ src, monochrome, initial, toValue() { return { src, monochrome, initial }; } });
}
AIProviderLogoModel.of = AIProviderLogoModel;
export { AIProviderLogoModel };
