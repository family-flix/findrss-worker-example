// APIDurableObject 的建表 DDL。单独成模块，让「表集合」与「索引只引用同 DDL 里的列」
// 能在纯 node --test 下静态断言（durable_object.js 依赖 `cloudflare:workers`，Node 加载不了）。
//
// **这里只放可以在任何库上先跑的 CREATE**：`CREATE TABLE IF NOT EXISTS` 对已存在的表是
// no-op，不会补列，所以带 PRAGMA 守卫的 ALTER 与依赖它们的索引（calls_access_token、
// calls_coalesce、access_tokens_user、scripts_path）必须留在 constructor 里、
// 按原顺序跑在 ALTER 之后。
// 本轮之前它们和 CREATE 混在一起；提前 CREATE 是安全的，因为被 ALTER 的表在本 DDL 里
// 已经带着新列（新库直接建全，老库靠随后的 ALTER 补，索引再其后）。

// 在建新表前迁移旧名称，避免已有脚本、执行日志与模型密钥被留在旧表。
export function migrate_script_tables(sql) {
  const tables = new Set(sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map(row => row.name));
  for (const [previous, current, indexes] of [
    ["rss_scripts", "scripts", ["rss_scripts_path"]],
    ["rss_script_logs", "script_logs", ["rss_script_logs_route_time", "rss_script_logs_retention", "rss_script_logs_errors"]],
    ["rss_script_agent_settings", "script_agent_settings", []],
  ]) {
    if (!tables.has(previous)) continue;
    if (tables.has(current)) throw new Error(`Cannot migrate ${previous}: ${current} already exists`);
    sql.exec(`ALTER TABLE ${previous} RENAME TO ${current}`);
    for (const index of indexes) sql.exec(`DROP INDEX IF EXISTS ${index}`);
  }
}

/** 本模块 DDL 里恰好这些表。 @type {readonly string[]} */
export const API_TABLE_NAMES = Object.freeze([
  "rss_cookie_grants",
  "device_tokens",
  "script_agent_settings",
  "calls",
  "devices",
  "device_logs",
  "users",
  "user_credentials",
  "reader_email_verifications",
  "reader_signup_ip_limits",
  "access_tokens",
  "credit_transactions",
  "user_events",
  "redemption_campaigns",
  "redemption_cards",
  "redemption_uses",
  "discovery_sources",
  "discovery_source_avatars",
  "discovery_source_seeds",
  "discovery_source_snapshots",
  "discovery_source_calls",
  "scripts",
  "rss_cookie_store",
  "script_logs",
  "rss_route_cache",
  "rss_route_cache_chunks",
  "rss_public_feeds",
]);

export const API_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS rss_cookie_grants (
    id TEXT PRIMARY KEY, script_id TEXT NOT NULL, script_hash TEXT NOT NULL,
    permissions_json TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rss_cookie_grants_script ON rss_cookie_grants(script_id);

  CREATE TABLE IF NOT EXISTS device_tokens (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE, token_hint TEXT NOT NULL, encrypted_token TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER, last_used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS device_tokens_expiry ON device_tokens(expires_at) WHERE revoked_at IS NULL;

  CREATE TABLE IF NOT EXISTS script_agent_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '',
    encrypted_keys_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    publisher_device_id TEXT NOT NULL,
    access_token_id TEXT,
    credit_cost INTEGER NOT NULL DEFAULT 0,
    target_device_id TEXT,
    idempotency_key TEXT,
    coalesce_key TEXT,
    args_json TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_device_id TEXT,
    lease_token TEXT,
    lease_expires_at INTEGER,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS calls_idempotency
    ON calls(publisher_device_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS calls_dispatch
    ON calls(status, created_at);
  CREATE INDEX IF NOT EXISTS calls_lease
    ON calls(status, lease_expires_at);
  CREATE INDEX IF NOT EXISTS calls_device_load
    ON calls(assigned_device_id, status);
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    methods_json TEXT NOT NULL,
    device_name TEXT NOT NULL DEFAULT '',
    device_os TEXT NOT NULL DEFAULT '',
    max_concurrency INTEGER NOT NULL DEFAULT 1,
    connected_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    disconnected_at INTEGER,
    status TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS devices_status
    ON devices(status, last_seen_at);
  CREATE TABLE IF NOT EXISTS device_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    connection_id TEXT,
    category TEXT NOT NULL,
    event_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    level TEXT NOT NULL,
    task_id TEXT,
    method TEXT,
    message TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS device_logs_device_time
    ON device_logs(device_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS device_logs_retention
    ON device_logs(created_at);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    email_verified_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_credentials_email
    ON user_credentials(email);
  CREATE TABLE IF NOT EXISTS reader_email_verifications (
    user_id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reader_signup_ip_limits (
    ip_hash TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    sends INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS access_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_hint TEXT NOT NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER,
    credit_balance INTEGER NOT NULL DEFAULT 0,
    total_credits_granted INTEGER NOT NULL DEFAULT 0,
    total_credits_used INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS access_tokens_expiration
    ON access_tokens(expires_at);
  CREATE TABLE IF NOT EXISTS credit_transactions (
    id TEXT PRIMARY KEY,
    access_token_id TEXT NOT NULL,
    task_id TEXT,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    method TEXT,
    subject TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_transactions_token_time
    ON credit_transactions(access_token_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_task_charge
    ON credit_transactions(task_id) WHERE type = 'charge';
  CREATE TABLE IF NOT EXISTS user_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    access_token_id TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_events_user_time
    ON user_events(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS user_events_time
    ON user_events(created_at);
  CREATE TABLE IF NOT EXISTS redemption_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    credits INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    starts_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS redemption_campaigns_created
    ON redemption_campaigns(created_at DESC);
  CREATE TABLE IF NOT EXISTS redemption_cards (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    code_hint TEXT NOT NULL,
    credits INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS redemption_cards_campaign
    ON redemption_cards(campaign_id, created_at);
  CREATE TABLE IF NOT EXISTS redemption_uses (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    card_id TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    access_token_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(campaign_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS redemption_uses_user
    ON redemption_uses(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS discovery_sources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    feed_url TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    require_token INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_type TEXT NOT NULL DEFAULT 'website',
    avatar_updated_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS discovery_sources_listing
    ON discovery_sources(enabled, category, sort_order, title);
  -- 头像 R2 指针与旧字节单独存表，列表 SELECT * 不加载图片。
  CREATE TABLE IF NOT EXISTS discovery_source_avatars (
    source_id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    bytes BLOB NOT NULL,
    object_key TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discovery_source_seeds (
    id TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS discovery_source_snapshots (
    source_id TEXT PRIMARY KEY,
    feed_url TEXT NOT NULL,
    articles_json TEXT NOT NULL DEFAULT '[]',
    saved_at INTEGER NOT NULL DEFAULT 0,
    attempted_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS discovery_source_calls (
    source_id TEXT PRIMARY KEY,
    call_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS scripts (
    route TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    script TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rss_cookie_store (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cookies_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS script_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    method TEXT NOT NULL,
    pathname TEXT NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}',
    query_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    error_text TEXT NOT NULL DEFAULT '',
    lines_json TEXT NOT NULL DEFAULT '[]',
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    invoked INTEGER NOT NULL DEFAULT 0,
    device_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS script_logs_route_time
    ON script_logs(route, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS script_logs_retention
    ON script_logs(created_at);
  CREATE INDEX IF NOT EXISTS script_logs_errors
    ON script_logs(id DESC) WHERE status = 'error';
  -- RSS/Atom 快照持久化 feed JSON 与两种 XML；大快照分块，兼容已有缓存表。
  CREATE TABLE IF NOT EXISTS rss_route_cache (
    key TEXT PRIMARY KEY,
    output_json TEXT NOT NULL,
    invoked INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rss_route_cache_expiry
    ON rss_route_cache(expires_at);
  CREATE TABLE IF NOT EXISTS rss_route_cache_chunks (
    key TEXT NOT NULL, chunk_index INTEGER NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY (key, chunk_index)
  );
  CREATE TABLE IF NOT EXISTS rss_public_feeds (
    key TEXT PRIMARY KEY, pathname TEXT NOT NULL, query_json TEXT NOT NULL,
    self_url TEXT NOT NULL, attempted_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS rss_public_feeds_due ON rss_public_feeds(attempted_at);
`;
