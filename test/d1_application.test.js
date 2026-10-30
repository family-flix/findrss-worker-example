import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { d1_fixture } from "./support/d1.js";
import { D1Store } from "../server/infra/d1.js";
register("./support/quickjs_wasm_hook.js", import.meta.url);
register("./support/application_hook.js", import.meta.url);
const {
  Application
} = await import("../server/application.js");
const make_app = (db, extra = {}) => new Application({
  DB: db,
  ADMIN_PASSWORD: 'test-password',
  REALTIME: {
    getByName: () => ({
      broadcast: async () => {},
      connections: async () => []
    })
  },
  JOBS: {
    send: async () => {}
  },
  ...extra
}, {
  waitUntil: promise => promise.catch(() => {})
});
test("D1 transaction rejects stale reads and rolls back every write", async () => {
  const db = d1_fixture(),
    store = new D1Store(db);
  await store.put("balance", 10);
  await assert.rejects(store.transaction(async () => {
    assert.equal(await store.get("balance"), 10);
    db.sql.exec("UPDATE application_settings SET value_json='5' WHERE key='balance'");
    await store.put("balance", 9);
    await store.put("ledger", 1);
  }), /数据已被/);
  assert.equal(await store.get("balance"), 5);
  assert.equal(await store.get("ledger"), undefined);
  db.sql.close();
});
test('concurrent D1 feed charges never overdraw or leave a partial ledger', async () => {
  const db = d1_fixture(),
    app = make_app(db);
  const response = await app.app.access_tokens.create_access_token(new Request('https://internal', {
    method: 'POST',
    body: JSON.stringify({
      name: 'balance',
      credits: 1
    })
  }));
  const id = response.data.access_token.id;
  const results = await Promise.allSettled(Array.from({
    length: 8
  }, () => make_app(db).app.credit.charge_feed_access(id, {
    credit_cost: 1,
    title: 'feed'
  })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(db.sql.prepare('SELECT credit_balance FROM access_tokens WHERE id=?').get(id).credit_balance, 0);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM credit_transactions WHERE type='charge'").get().n, 1);
  db.sql.close();
});
test('fresh Worker instances keep queued jobs and queue redelivery is idempotent', async () => {
  const db = d1_fixture(),
    messages = [],
    app = make_app(db, {
      JOBS: {
        send: async value => messages.push(value)
      }
    });
  const task = await app.jobs.enqueue('hot-snapshot', {
    kind: 'hot_snapshot',
    title: 'hot',
    target: '/rank/'
  });
  const next = make_app(db);
  assert.equal((await next.app.background_tasks.list(new URL('https://internal'))).tasks[0].id, task.id);
  let count = 0;
  next.app.hot_snapshots.start = async () => {
    count++;
  };
  await next.jobs.consume(task.id);
  await next.jobs.consume(task.id);
  assert.equal(count, 1);
  assert.equal(db.sql.prepare('SELECT status FROM jobs WHERE id=?').get(task.id).status, 'completed');
  db.sql.close();
});
test('D1 script publication and discovery CRUD keep route metadata usable', async () => {
  const db = d1_fixture(),
    app = make_app(db);
  const script = `export const route={ name:'D1 test',path:'/d1-test',example:'/d1-test',public:true,handler:()=>Result.Ok({title:'D1 feed',link:'https://example.com',items:[]}) };`;
  const result = await app.app.scripts.create_script(new Request('https://internal', {
    method: 'POST',
    body: JSON.stringify({
      script,
      version: '1.0.0',
      status: 'published'
    })
  }));
  assert.ok(result.data?.script || result.script, JSON.stringify(result));
  const listed = await app.app.scripts.list_scripts();
  assert.equal(listed.scripts.length, 1);
  assert.equal(listed.scripts[0].path, '/d1-test');
  db.sql.close();
});
test("application reads and writes D1 without invoking a Durable Object", async () => {
  const db = d1_fixture(),
    pending = [];
  const app = new Application({
    DB: db,
    ADMIN_PASSWORD: "test-password",
    REALTIME: {
      getByName: () => ({})
    },
    JOBS: {
      send: async () => {}
    }
  }, {
    waitUntil: promise => pending.push(promise)
  });
  for (const path of ["/_admin/discovery/sources", "/_admin/settings/snapshots", "/_admin/clips", "/_admin/detections", "/_admin/scripts", "/_admin/users"]) {
    const response = await app.fetch(new Request("https://internal" + path));
    assert.equal(response.status, 200, path + ": " + (await response.clone().text()));
  }
  const response = await app.fetch(new Request("https://internal/_admin/settings/snapshots", {
    method: "PUT",
    body: JSON.stringify({
      max_concurrency: 2
    })
  }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).max_concurrency, 2);
  await Promise.all(pending);
  db.sql.close();
});
test('D1 optimistic guard handles more than 100 returned values without oversized bindings', async () => {
  const db = d1_fixture(),
    store = new D1Store(db);
  for (let index = 0; index < 120; index++) await store.put('row-' + index, index);
  await store.transaction(async () => {
    assert.equal((await store.exec('SELECT * FROM application_settings ORDER BY key')).toArray().length, 120);
    await store.put('committed', true);
  });
  assert.equal(await store.get('committed'), true);
  await assert.rejects(store.transaction(async () => {
    assert.equal((await store.exec("SELECT * FROM application_settings WHERE key='absent'")).toArray().length, 0);
    db.sql.exec("INSERT INTO application_settings VALUES('absent','1')");
    await store.put('partial', true);
  }), {
    status: 409
  });
  assert.equal(await store.get('partial'), undefined);
  db.sql.close();
});
test('KV failures fall back to D1, cache updates are visible locally and namespaces stay isolated', async () => {
  const {
    ReadCache
  } = await import('../server/infra/read_cache.js');
  let reads = 0;
  const pending = [],
    namespace = {
      get: async () => {
        throw new Error('unavailable');
      },
      put: async () => {
        throw new Error('unavailable');
      }
    };
  const cache = new ReadCache(namespace, promise => pending.push(promise));
  assert.deepEqual(await cache.read('list', async () => {
    reads++;
    return ['D1'];
  }), ['D1']);
  assert.deepEqual(await cache.read('list', () => assert.fail('local hit')), ['D1']);
  await cache.put('list', ['new']);
  assert.deepEqual(await cache.read('list', () => assert.fail('fresh local value')), ['new']);
  const other = new ReadCache({
    get: async () => ['other']
  }, promise => pending.push(promise));
  assert.deepEqual(await other.read('list', () => assert.fail('namespace hit')), ['other']);
  assert.equal(reads, 1);
  await Promise.all(pending);
});
test('D1 device dispatch binds JSON lists within the 100 parameter limit', async () => {
  const db = d1_fixture(),
    prepare = db.prepare;
  db.prepare = query => {
    const statement = prepare(query),
      bind = statement.bind;
    statement.bind = function (...values) {
      assert.ok(values.length <= 100, 'D1 parameter limit');
      return bind.apply(this, values);
    };
    return statement;
  };
  const app = make_app(db);
  await app.storage.exec("INSERT INTO calls(id,method,publisher_device_id,args_json,status,created_at,updated_at) VALUES('one','echo','publisher','{}','queued',0,0)");
  const rows = await app.repo.calls.list_dispatchable(Array.from({
    length: 200
  }, (_, i) => 'device-' + i), ['echo', ...Array.from({
    length: 200
  }, (_, i) => 'method-' + i)], 10);
  assert.equal(rows[0].id, 'one');
  db.sql.close();
});
test('ordinary paths ending in ws do not enter the administrator websocket hub', async () => {
  const db = d1_fixture(),
    app = make_app(db, {
      REALTIME: {
        getByName: () => ({
          fetch: () => assert.fail('unexpected websocket upgrade')
        })
      }
    });
  assert.equal((await app.fetch(new Request('https://internal/unknown/ws', {
    headers: {
      Upgrade: 'websocket'
    }
  }))).status, 404);
  db.sql.close();
});
test('KV route projections exclude source code, config credentials and cookie grants', async () => {
  const db = d1_fixture(),
    values = [],
    app = make_app(db, {
      CACHE: {
        get: async () => null,
        put: async (key, value) => values.push(value)
      }
    });
  await app.repo.scripts.insert({
    route: 'cached',
    title: 'cached',
    path: '/cached',
    script: '// private-source',
    enabled: 1,
    created_at: 0,
    updated_at: 0,
    metadata_json: JSON.stringify({
      path: '/cached',
      kind: 'hot',
      status: 'published',
      config: {
        api_key: 'private-api-key'
      },
      cookie_grant_id: 'private-grant',
      draft: {
        script: 'private-draft'
      }
    })
  });
  assert.equal((await app.repo.scripts.list_enabled())[0].route, 'cached');
  assert.ok(values.length);
  assert.doesNotMatch(values.join(''), /private-source|private-api-key|private-grant|private-draft/);
  assert.equal(JSON.parse(JSON.parse(values[0])[0].metadata_json).kind, 'hot');
  db.sql.close();
});
test('clip and detection lists keep running state across fresh Worker instances', async () => {
  const db = d1_fixture(),
    app = make_app(db);
  db.sql.exec("INSERT INTO clips(id,title,url,selector,config_version,created_at) VALUES('clip','clip','https://example.com','body','v',0)");
  db.sql.exec("INSERT INTO detections(id,title,script_id,script_url,config_version,created_at) VALUES('detect','detect','script','/detect','v',0)");
  const clip = await app.jobs.enqueue('clip:clip', {
    kind: 'clip',
    target: 'clip'
  }, false);
  const detect = await app.jobs.enqueue('detect:detect', {
    kind: 'detect',
    target: 'detect'
  }, false);
  assert.equal((await make_app(db).app.clips.list()).clips[0].refreshing, true);
  assert.equal((await make_app(db).app.detections.list()).detections[0].running, true);
  await app.jobs.cancel(clip.id);
  await app.jobs.cancel(detect.id);
  assert.equal((await make_app(db).app.clips.list()).clips[0].refreshing, false);
  assert.equal((await make_app(db).app.detections.list()).detections[0].running, false);
  db.sql.close();
});
test('draft media previews survive a fresh Worker without publishing the draft route', async () => {
  const {
    create_memory_bucket
  } = await import('@findrss/object-store');
  const db = d1_fixture(),
    API_STORAGE = create_memory_bucket(),
    app = make_app(db, {
      API_STORAGE
    });
  const preview = await app.app.scripts.preview_assets.create({
    script: 'private-draft',
    metadata: {
      routes: [{
        path: '/image',
        allowed_hosts: ['example.com']
      }]
    },
    public_origin: 'https://example.com'
  });
  const id = preview.endpoint.split('/').pop();
  const next = make_app(db, {
    API_STORAGE
  });
  assert.equal((await next.app.scripts.preview_assets.get(id)).script, 'private-draft');
  assert.equal((await next.repo.scripts.list()).length, 0);
  for (const object of API_STORAGE.objects.values()) object.uploaded = new Date(Date.now() - 16 * 60000);
  await next.app.scripts.preview_assets.prune();
  assert.equal(await app.app.scripts.preview_assets.get(id), null);
  db.sql.close();
});
test('source recovery recognizes XML jobs under a different task key across Workers', async () => {
  const db = d1_fixture(),
    app = make_app(db);
  const task = await app.jobs.enqueue('public-snapshot:/source', {
    kind: 'snapshot',
    source_id: 'source'
  }, false);
  assert.equal(await make_app(db).app.background_tasks.is_source_running('source'), true);
  await app.jobs.cancel(task.id);
  assert.equal(await make_app(db).app.background_tasks.is_source_running('source'), false);
  db.sql.close();
});
test('concurrent source creation cannot exceed the D1 source limit', async () => {
  const db = d1_fixture();
  db.sql.exec("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<999) INSERT INTO discovery_sources(id,title,feed_url,category,created_at,updated_at) SELECT 'existing-'||i,'Existing','https://example.com/'||i,'',0,0 FROM n");
  const create = index => {
    const app = make_app(db);
    app.app.discovery.publish_catalog = async () => {};
    return app.app.discovery.create_discovery_source(new Request('https://internal', {
      method: 'POST',
      body: JSON.stringify({
        title: 'new',
        feed_url: 'https://example.com/new-' + index,
        enabled: false,
        require_token: true
      })
    }));
  };
  const results = await Promise.allSettled([create(1), create(2)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM discovery_sources').get().n, 1000);
  db.sql.close();
});
