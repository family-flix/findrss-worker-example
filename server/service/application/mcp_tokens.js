import { McpTokenModel } from "../../domain/mcp_token.js";
import { sha256_hex } from "../../lib/crypto.js";
import { access_token_hint } from "../../lib/identifiers.js";
import { MCP_TOOL_SCOPES, MCP_TOOLS } from "../../lib/mcp_tools.js";
import { do_error, do_result, DurableObjectResult } from "./error.js";
import { load_discovery_profile } from "../../infra/discovery_snapshot.js";
const challenge = {
  "WWW-Authenticate": 'Bearer realm="FindRSS MCP", error="invalid_token"'
};
export class ServiceMcpToken {
  constructor({
    repo,
    app,
    load_profile = load_discovery_profile
  }) {
    this.repo = repo;
    this.app = app;
    this.load_profile = load_profile;
  }
  async list(resource) {
    const now = Date.now();
    return {
      resource,
      mcp_tokens: (await this.repo.list(now)).map(row => ({
        ...McpTokenModel(row).toValue(now),
        authorization_type: row.token_hash.startsWith("oauth:") ? "oauth" : "legacy_token"
      }))
    };
  }
  async find(id) {
    const row = await this.repo.find(id);
    if (!row) throw do_error("MCP token not found", 404);
    return row;
  }
  async create(body, resource) {
    const parsed = McpTokenModel.parse(body);
    if (!parsed.ok) throw do_error(parsed.error.message, parsed.error.status);
    const token = "fr_mcp_" + [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const token_hash = await sha256_hex(token);
    const now = Date.now();
    // No await between checking the limit and inserting the row.
    if ((await this.repo.count_active(now)) >= McpTokenModel.MAX_TOKENS) throw do_error("MCP token limit reached", 409);
    const row = {
      id: crypto.randomUUID(),
      name: parsed.name,
      token_hash,
      token_hint: access_token_hint(token),
      scopes_json: JSON.stringify(parsed.scopes),
      resource,
      created_at: now,
      expires_at: now + parsed.lifetime * 1000
    };
    await this.repo.insert(row);
    return do_result({
      mcp_token: McpTokenModel(row).toValue(),
      token
    }, 201);
  }
  async revoke(id) {
    await this.find(id);
    await this.repo.revoke(id, Date.now());
    return {
      mcp_token: McpTokenModel(await this.find(id)).toValue()
    };
  }
  async calls(id) {
    await this.find(id);
    return {
      calls: await this.repo.calls(id)
    };
  }
  async verify(authorization, resource) {
    const token = /^Bearer (fr_mcp_[0-9a-f]{64})$/i.exec(authorization ?? "")?.[1];
    if (!token) throw do_error("MCP token required", 401, {}, challenge);
    const hash = await sha256_hex(token);
    const row = (await this.repo.find_by_hash(hash)) || (await this.app?.mcp_oauth?.verify_access(hash, resource));
    if (!row || row.resource !== resource || !McpTokenModel(row).is_active_at()) throw do_error("invalid MCP token", 401, {}, challenge);
    return {
      id: row.id
    };
  }
  async authorize(id, resource, message) {
    // Re-read after the request body has been consumed, so revocations during parsing also apply.
    const row = await this.repo.find(id);
    const model = row && McpTokenModel(row);
    if (!model || model.resource !== resource || !model.is_active_at()) throw do_error("invalid MCP token", 401, {}, challenge);
    const name = message.method === "tools/call" ? message.params?.name : undefined;
    if (typeof name === "string" && Object.hasOwn(MCP_TOOL_SCOPES, name) && !model.allows(name)) {
      await this.repo.record_call(id, name, "denied", Date.now());
      throw do_error("insufficient MCP scope", 403, {}, {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${MCP_TOOL_SCOPES[name]}"`
      });
    }
    await this.repo.set_last_used(id, Date.now());
    return MCP_TOOLS.filter(tool => model.allows(tool.name));
  }
  async call(id, resource, name, args, public_origin) {
    await this.authorize(id, resource, {
      method: "tools/call",
      params: {
        name
      }
    });
    if (typeof name !== "string" || !Object.hasOwn(MCP_TOOL_SCOPES, name)) throw do_error("unknown MCP tool", 400);
    const request = new Request("https://internal/_admin/scripts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Feed-Public-URL": public_origin
      },
      body: JSON.stringify(args)
    });
    try {
      const result = name === "add_script" ? await this.app.scripts.create_script(request) : await this.add_subscription(id, resource, args, public_origin);
      await this.repo.record_call(id, name, result instanceof DurableObjectResult && result.status >= 400 ? "error" : "success", Date.now());
      return result;
    } catch (error) {
      await this.repo.record_call(id, name, "error", Date.now());
      throw error;
    }
  }
  async add_subscription(id, resource, args, public_origin) {
    let profile;
    try {
      profile = await this.load_profile({
        ...args,
        require_token: true
      }, public_origin, async (...params) => await this.app.scripts.serve_rss_route(...params));
    } catch (error) {
      throw do_error("读取订阅源信息失败：" + error.message, 502);
    }
    const defaults = profile.defaults;
    if (!defaults?.title?.trim()) throw do_error("订阅源未返回有效名称，未创建订阅", 422);
    // Recheck after reading the feed; a revoked grant cannot create or upload anything.
    await this.authorize(id, resource, {
      method: "tools/call",
      params: {
        name: "add_subscription"
      }
    });
    const body = {
      ...args,
      title: defaults.title,
      description: defaults.description || "",
      website: defaults.website || "",
      ...(args.tags === undefined && defaults.tags?.length ? {
        tags: defaults.tags
      } : {})
    };
    const result = await this.app.discovery.create_discovery_source(new Request("https://internal/_admin/discovery/sources", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Feed-Public-URL": public_origin
      },
      body: JSON.stringify(body)
    }));
    if (!(result instanceof DurableObjectResult) || result.status >= 400 || !profile.avatar) return result;
    const source = result.data.source;
    try {
      await this.authorize(id, resource, {
        method: "tools/call",
        params: {
          name: "add_subscription"
        }
      });
      const avatar = Uint8Array.from(atob(profile.avatar.data), char => char.charCodeAt(0));
      const uploaded = await this.app.discovery.put_discovery_avatar(new Request("https://internal/avatar", {
        method: "PUT",
        body: avatar
      }), source.id);
      return do_result({
        ...result.data,
        source: {
          ...source,
          ...uploaded.source
        }
      }, result.status, result.headers);
    } catch (error) {
      throw do_error("订阅已创建，但头像保存失败：" + error.message, 502, {
        source
      });
    }
  }
}
