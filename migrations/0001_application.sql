-- Fresh D1 database; no legacy Durable Object data is read.

  CREATE TABLE IF NOT EXISTS api_schema_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS overview_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot_json TEXT NOT NULL,
    generated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    script_id TEXT NOT NULL DEFAULT '',
    script_url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    selector TEXT NOT NULL,
    viewport_width INTEGER NOT NULL DEFAULT 1440,
    viewport_height INTEGER NOT NULL DEFAULT 900,
    wait_ms INTEGER NOT NULL DEFAULT 1000,
    enabled INTEGER NOT NULL DEFAULT 1,
    poll_policy_json TEXT NOT NULL DEFAULT '{"mode":"inherit"}',
    poll_updated_at INTEGER NOT NULL DEFAULT 0,
    config_version TEXT NOT NULL,
    node TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    object_key TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    byte_size INTEGER NOT NULL DEFAULT 0,
    image_missing INTEGER NOT NULL DEFAULT 0,
    fingerprint TEXT NOT NULL DEFAULT '',
    adaptive_interval INTEGER NOT NULL DEFAULT 0,
    attempted_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    saved_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS detections (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, script_id TEXT NOT NULL, script_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, poll_policy_json TEXT NOT NULL DEFAULT '{"mode":"inherit"}',
    poll_updated_at INTEGER NOT NULL DEFAULT 0, config_version TEXT NOT NULL,
    baseline_id TEXT NOT NULL DEFAULT '', last_run_id TEXT NOT NULL DEFAULT '',
    attempted_at INTEGER NOT NULL DEFAULT 0, saved_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '', adaptive_interval INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS detection_runs (
    id TEXT PRIMARY KEY, detection_id TEXT NOT NULL, status TEXT NOT NULL, observed_at INTEGER NOT NULL,
    previous_id TEXT NOT NULL DEFAULT '', object_key TEXT NOT NULL DEFAULT '', body_json TEXT NOT NULL DEFAULT '',
    change_count INTEGER NOT NULL DEFAULT 0, match_count INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS detection_runs_recent ON detection_runs(detection_id,observed_at DESC);
  CREATE TABLE IF NOT EXISTS snapshot_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    policy_json TEXT NOT NULL,
    max_concurrency INTEGER NOT NULL DEFAULT 4,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS background_tasks (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, target TEXT NOT NULL,
    source_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS background_tasks_recent ON background_tasks(started_at);
  CREATE INDEX IF NOT EXISTS background_tasks_status_time ON background_tasks(status, started_at);
  CREATE INDEX IF NOT EXISTS background_tasks_finished_time ON background_tasks(started_at) WHERE status != 'running';
  CREATE TABLE IF NOT EXISTS cookie_push_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    uuid TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhook_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    url TEXT NOT NULL,
    encrypted_token TEXT NOT NULL,
    template TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platforms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY, created_at INTEGER NOT NULL
  );
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

  CREATE TABLE IF NOT EXISTS mcp_tokens (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_hint TEXT NOT NULL,
    scopes_json TEXT NOT NULL, resource TEXT NOT NULL, created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, revoked_at INTEGER, last_used_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS mcp_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, token_id TEXT NOT NULL,
    tool_name TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mcp_calls_token ON mcp_calls(token_id, id DESC);

  CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
    id TEXT PRIMARY KEY, resource TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
    id TEXT PRIMARY KEY, resource TEXT NOT NULL, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
    state TEXT NOT NULL, scopes_json TEXT NOT NULL, code_challenge TEXT NOT NULL, code_hash TEXT UNIQUE,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mcp_oauth_requests_expiry ON mcp_oauth_requests(expires_at);
  CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mcp_oauth_credentials (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE,
    refresh_hash TEXT NOT NULL UNIQUE, access_expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS mcp_oauth_credentials_grant ON mcp_oauth_credentials(grant_id);

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
  CREATE TABLE IF NOT EXISTS call_status_counts (
    status TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TRIGGER IF NOT EXISTS calls_count_insert AFTER INSERT ON calls BEGIN
    INSERT INTO call_status_counts(status, count) VALUES (NEW.status, 1)
      ON CONFLICT(status) DO UPDATE SET count = count + 1;
  END;
  CREATE TRIGGER IF NOT EXISTS calls_count_delete AFTER DELETE ON calls BEGIN
    UPDATE call_status_counts SET count = count - 1 WHERE status = OLD.status;
  END;
  CREATE TRIGGER IF NOT EXISTS calls_count_update AFTER UPDATE OF status ON calls
    WHEN OLD.status <> NEW.status BEGIN
    UPDATE call_status_counts SET count = count - 1 WHERE status = OLD.status;
    INSERT INTO call_status_counts(status, count) VALUES (NEW.status, 1)
      ON CONFLICT(status) DO UPDATE SET count = count + 1;
  END;
  CREATE UNIQUE INDEX IF NOT EXISTS calls_idempotency
    ON calls(publisher_device_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS calls_dispatch
    ON calls(status, created_at);
  CREATE INDEX IF NOT EXISTS calls_recent ON calls(created_at DESC);
  CREATE INDEX IF NOT EXISTS calls_publisher_recent ON calls(publisher_device_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS calls_lease
    ON calls(status, lease_expires_at);
  CREATE INDEX IF NOT EXISTS calls_retention
    ON calls(status, completed_at) WHERE status IN ('completed', 'failed');
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
    social_url TEXT NOT NULL DEFAULT '',
    social_urls_json TEXT NOT NULL DEFAULT '[]',
    feed_url TEXT NOT NULL UNIQUE,
    route_pathname TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    require_token INTEGER NOT NULL DEFAULT 0,
    credit_cost INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_type TEXT NOT NULL DEFAULT 'website',
    poll_policy_json TEXT NOT NULL DEFAULT '{"mode":"inherit"}',
    poll_updated_at INTEGER NOT NULL DEFAULT 0,
    avatar_updated_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS discovery_sources_listing
    ON discovery_sources(enabled, category, sort_order, title);
  CREATE INDEX IF NOT EXISTS discovery_sources_recent ON discovery_sources(created_at DESC, id);
  CREATE INDEX IF NOT EXISTS discovery_sources_public_order
    ON discovery_sources(enabled, sort_order, title COLLATE NOCASE, id);
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
    adaptive_interval INTEGER NOT NULL DEFAULT 0,
    poll_fingerprint TEXT NOT NULL DEFAULT '',
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
  CREATE TABLE IF NOT EXISTS script_releases (
    id TEXT PRIMARY KEY, script_id TEXT NOT NULL, version TEXT NOT NULL,
    script_hash TEXT NOT NULL, bytes INTEGER NOT NULL,
    script TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(script_id, version)
  );
  CREATE INDEX IF NOT EXISTS script_releases_script ON script_releases(script_id, created_at);
  CREATE TABLE IF NOT EXISTS script_release_events (
    id TEXT PRIMARY KEY, script_id TEXT NOT NULL, action TEXT NOT NULL,
    from_id TEXT NOT NULL DEFAULT '', to_id TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS script_release_events_script ON script_release_events(script_id, created_at);
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
  -- RSS/Atom 快照保存 R2 指针；兼容旧 feed JSON/XML 正文与分块，普通缓存仍存 SQLite。
  CREATE TABLE IF NOT EXISTS rss_route_cache (
    key TEXT PRIMARY KEY,
    output_json TEXT NOT NULL,
    invoked INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rss_route_cache_temporary_expiry
    ON rss_route_cache(expires_at, key)
    WHERE key NOT LIKE 'public-snapshot:%' AND key NOT LIKE 'private-snapshot:%';
  CREATE INDEX IF NOT EXISTS rss_route_cache_temporary_created
    ON rss_route_cache(created_at DESC)
    WHERE key NOT LIKE 'public-snapshot:%' AND key NOT LIKE 'private-snapshot:%';
  CREATE TABLE IF NOT EXISTS rss_route_cache_chunks (
    key TEXT NOT NULL, chunk_index INTEGER NOT NULL, body TEXT NOT NULL,
    PRIMARY KEY (key, chunk_index)
  );
  CREATE TRIGGER IF NOT EXISTS rss_route_cache_delete_chunks AFTER DELETE ON rss_route_cache BEGIN
    DELETE FROM rss_route_cache_chunks WHERE key = OLD.key;
  END;
  CREATE TABLE IF NOT EXISTS rss_public_feeds (
    key TEXT PRIMARY KEY, pathname TEXT NOT NULL, query_json TEXT NOT NULL,
    self_url TEXT NOT NULL, attempted_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS rss_public_feeds_due ON rss_public_feeds(attempted_at);

CREATE TABLE application_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE transaction_guard(ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE jobs(
 id TEXT PRIMARY KEY, task_key TEXT NOT NULL, descriptor_json TEXT NOT NULL,
 status TEXT NOT NULL, created_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
 sent_at INTEGER, lease_token TEXT, lease_until INTEGER, finished_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX jobs_active ON jobs(task_key) WHERE status IN ('queued','running');
CREATE INDEX jobs_due ON jobs(status,available_at);
CREATE INDEX jobs_lease ON jobs(status,lease_until);
CREATE INDEX jobs_recent ON jobs(created_at DESC);
CREATE INDEX calls_coalesce ON calls(coalesce_key) WHERE coalesce_key IS NOT NULL;
CREATE INDEX access_tokens_user ON access_tokens(user_id,created_at DESC);
CREATE INDEX scripts_path ON scripts(path);
CREATE TABLE schedules(kind TEXT NOT NULL,target_id TEXT NOT NULL,due_at INTEGER NOT NULL,PRIMARY KEY(kind,target_id));
CREATE INDEX schedules_due ON schedules(due_at);

CREATE INDEX discovery_sources_route ON discovery_sources(route_pathname,enabled,require_token);

CREATE TRIGGER schedule_discovery_insert AFTER INSERT ON discovery_sources BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('discovery',NEW.id,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_discovery_update AFTER UPDATE ON discovery_sources BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('discovery',NEW.id,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_discovery_delete AFTER DELETE ON discovery_sources BEGIN DELETE FROM schedules WHERE kind='discovery' AND target_id=OLD.id; END;

CREATE TRIGGER schedule_clip_insert AFTER INSERT ON clips BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('clip',NEW.id,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_clip_update AFTER UPDATE ON clips BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('clip',NEW.id,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_clip_delete AFTER DELETE ON clips BEGIN DELETE FROM schedules WHERE kind='clip' AND target_id=OLD.id; END;

CREATE TRIGGER schedule_detect_insert AFTER INSERT ON detections BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('detect',NEW.id,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_detect_update AFTER UPDATE ON detections BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('detect',NEW.id,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_detect_delete AFTER DELETE ON detections BEGIN DELETE FROM schedules WHERE kind='detect' AND target_id=OLD.id; END;

CREATE TRIGGER schedule_rss_insert AFTER INSERT ON rss_public_feeds BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('rss',NEW.key,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_rss_update AFTER UPDATE ON rss_public_feeds BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('rss',NEW.key,0)
 ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;

CREATE TRIGGER schedule_rss_delete AFTER DELETE ON rss_public_feeds BEGIN DELETE FROM schedules WHERE kind='rss' AND target_id=OLD.key; END;

CREATE TRIGGER schedule_discovery_snapshot AFTER UPDATE ON discovery_source_snapshots BEGIN
 INSERT INTO schedules(kind,target_id,due_at) VALUES('discovery',NEW.source_id,0) ON CONFLICT(kind,target_id) DO UPDATE SET due_at=0;
END;
CREATE TRIGGER schedule_settings AFTER UPDATE ON snapshot_settings BEGIN UPDATE schedules SET due_at=0; END;
