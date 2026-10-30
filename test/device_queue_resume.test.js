import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceTask } from '../server/service/application/tasks.js';
test('resumable invoke preserves task reference and queue state on short-poll timeout', async () => {
  const service = new ServiceTask({
    repo: {
      calls: {
        find: () => ({
          status: 'queued'
        })
      }
    },
    ports: {},
    storage: {},
    app: {}
  });
  let flags;
  service.create_task = async (_request, ...args) => {
    flags = args;
    return {
      data: {
        task: {
          id: 'task-1'
        }
      }
    };
  };
  service.wait_for_invoke = async () => null;
  await assert.rejects(service.invoke(new Request('https://api/invoke'), 1000, true), error => {
    assert.equal(error.status, 504);
    assert.equal(error.headers['X-FindRSS-Task-ID'], 'task-1');
    assert.equal(error.headers['X-FindRSS-Task-State'], 'queued');
    return true;
  });
  assert.deepEqual(flags, [true, false]);
  service.wait_for_invoke = async () => ({
    status: 'completed',
    result_json: '{"value":1}'
  });
  const result = await service.invoke(new Request('https://api/invoke'), 1000, true);
  assert.deepEqual(result.data, {
    value: 1
  });
});
test('Worker forwards refresh identity and pending response without changing RSS contract', async () => {
  const {
    public_rss_route
  } = await import('../server/service/worker/rss.js');
  let forwarded;
  const env = {
    APPLICATION: (() => ({
      fetch: async request => {
        if (new URL(request.url).pathname === '/_public/feed/rss/wxmp/gh_test') {
          forwarded = await request.headers.get('X-FindRSS-Refresh-ID');
          return new Response('pending', {
            status: 503,
            headers: {
              'X-FindRSS-Pending': '1',
              'X-FindRSS-Task-ID': 'task-1'
            }
          });
        }
        return Response.json({
          public: true
        });
      }
    }))()
  };
  const response = await public_rss_route(env, new Request('https://api/rss/wxmp/gh_test', {
    headers: {
      'X-FindRSS-Refresh-ID': '12345678-1234-1234-1234-123456789abc'
    }
  }), '/wxmp/gh_test', 'rss');
  assert.equal(forwarded, '12345678-1234-1234-1234-123456789abc');
  assert.equal(response.status, 503);
  assert.equal(await response.headers.get('X-FindRSS-Pending'), '1');
});
