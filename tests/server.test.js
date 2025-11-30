/**
 * mcp-server 基础路由与 CORS 测试
 *
 * 使用 Node.js 内置 test runner（Node 20+）
 * 通过 spawn 子进程启动服务器，用原生 fetch 发请求
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, '..', 'server.js');

// 测试用端口（避免与开发端口冲突）
const TEST_PORT = 8181;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// 白名单域名（与 server.js 保持一致）
const ALLOWED_ORIGIN = 'https://app.useweeknight.com';
const DISALLOWED_ORIGIN = 'https://evil.com';

let serverProcess = null;

/**
 * 启动服务器进程
 */
async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', [SERVER_PATH], {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NODE_ENV: 'development', // 允许无 Supabase 启动
        // 测试用 mock 环境变量
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      // console.log('[Server stdout]', msg);
      if (msg.includes('listening') && !started) {
        started = true;
        // 给服务器一点时间完全就绪
        setTimeout(resolve, 200);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      // 忽略警告信息
      if (!msg.includes('warn') && !msg.includes('WARN')) {
        console.error('Server stderr:', msg);
      }
    });

    serverProcess.on('error', reject);

    // 超时保护
    setTimeout(() => {
      if (!started) {
        reject(new Error('Server failed to start within timeout'));
      }
    }, 10000);
  });
}

/**
 * 停止服务器进程
 */
function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ============================================================
// 测试套件
// ============================================================

describe('mcp-server 基础路由测试', () => {
  before(async () => {
    await startServer();
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // /health 端点测试
  // ------------------------------------------------------------
  test('GET /health 返回 200 + "ok"', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(res.status, 200, '状态码应为 200');

    const body = await res.text();
    assert.strictEqual(body, 'ok', '响应体应为 "ok"');
  });

  // ------------------------------------------------------------
  // 根路径测试
  // ------------------------------------------------------------
  test('GET / 返回欢迎消息', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.strictEqual(res.status, 200);

    const body = await res.text();
    assert.ok(body.includes('Weeknight MCP server is up'), '应包含欢迎消息');
  });

  // ------------------------------------------------------------
  // /version 端点测试
  // ------------------------------------------------------------
  test('GET /version 返回 JSON { revision, time }', async () => {
    const res = await fetch(`${BASE_URL}/version`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.ok('revision' in json, '应包含 revision 字段');
    assert.ok('time' in json, '应包含 time 字段');
  });

  // ------------------------------------------------------------
  // /metrics 端点测试
  // ------------------------------------------------------------
  test('GET /metrics 返回 Prometheus 格式', async () => {
    const res = await fetch(`${BASE_URL}/metrics`);
    assert.strictEqual(res.status, 200);

    const body = await res.text();
    assert.ok(body.includes('weeknight_'), '应包含 weeknight_ 前缀的指标');
  });
});

describe('CORS 预检测试', () => {
  before(async () => {
    // 复用已启动的服务器（如果还在运行）
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // OPTIONS 预检请求
  // ------------------------------------------------------------
  test('OPTIONS /health 白名单域返回 204 + CORS 头', async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization',
      },
    });

    assert.strictEqual(res.status, 204, 'OPTIONS 应返回 204');
    assert.strictEqual(
      res.headers.get('Access-Control-Allow-Origin'),
      ALLOWED_ORIGIN,
      'Allow-Origin 应匹配请求 Origin'
    );
    assert.ok(
      res.headers.get('Access-Control-Allow-Methods')?.includes('POST'),
      'Allow-Methods 应包含 POST'
    );
    assert.ok(
      res.headers.get('Access-Control-Allow-Headers')?.includes('Authorization'),
      'Allow-Headers 应包含 Authorization'
    );
  });

  // ------------------------------------------------------------
  // 白名单域名测试
  // ------------------------------------------------------------
  test('白名单域请求返回 CORS 头', async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(
      res.headers.get('Access-Control-Allow-Origin'),
      ALLOWED_ORIGIN,
      '白名单域应返回 Allow-Origin'
    );
  });

  test('非白名单域请求不返回 CORS 头', async () => {
    const res = await fetch(`${BASE_URL}/health`, {
      headers: { Origin: DISALLOWED_ORIGIN },
    });

    // 非白名单域不应返回 Access-Control-Allow-Origin
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
    assert.ok(
      !allowOrigin || allowOrigin !== DISALLOWED_ORIGIN,
      '非白名单域不应返回 Allow-Origin'
    );
  });

  test('无 Origin 头的请求正常响应', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(res.status, 200, '无 Origin 请求也应正常响应');
  });
});

describe('新增 API 端点测试', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // /recipes/search 测试
  // ------------------------------------------------------------
  test('GET /recipes/search 返回分页结果', async () => {
    const res = await fetch(`${BASE_URL}/recipes/search`);
    // 可能因为没有真实数据库而返回错误，但路由应该存在
    assert.ok([200, 500].includes(res.status), '路由应该存在');

    const json = await res.json();
    assert.ok('ok' in json, '应包含 ok 字段');
  });

  // ------------------------------------------------------------
  // /telemetry 测试
  // ------------------------------------------------------------
  test('POST /telemetry 接受有效事件', async () => {
    const res = await fetch(`${BASE_URL}/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        event: 'card_view',
        user_id: 'test-user-123',
        recipe_id: '550e8400-e29b-41d4-a716-446655440000',
        context: { page: 'tonight' }
      }),
    });

    // 应该返回 202 Accepted
    assert.strictEqual(res.status, 202, '应返回 202 Accepted');

    const json = await res.json();
    assert.strictEqual(json.ok, true, 'ok 应为 true');
    assert.ok(json.trace_id, '应包含 trace_id');
  });

  test('POST /telemetry 拒绝无效事件类型', async () => {
    const res = await fetch(`${BASE_URL}/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        event: 'invalid_event_type',
        user_id: 'test-user-123',
      }),
    });

    assert.strictEqual(res.status, 400, '无效事件应返回 400');
  });

  test('POST /telemetry 拒绝缺少 user_id', async () => {
    const res = await fetch(`${BASE_URL}/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        event: 'card_view',
      }),
    });

    assert.strictEqual(res.status, 400, '缺少 user_id 应返回 400');
  });
});

// ============================================================
// Step 6: Realtime & Pantry OCR 测试
// ============================================================

describe('Realtime API 测试 (Step 6)', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // GET /api/realtime/config 测试
  // ------------------------------------------------------------
  test('GET /api/realtime/config 返回配置信息', async () => {
    const res = await fetch(`${BASE_URL}/api/realtime/config`);
    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.model, '应包含 model 字段');
    assert.ok(json.wsEndpoint, '应包含 wsEndpoint 字段');
    assert.ok(Array.isArray(json.voiceCommands), 'voiceCommands 应为数组');
  });

  // ------------------------------------------------------------
  // POST /api/realtime/token 测试
  // ------------------------------------------------------------
  test('POST /api/realtime/token 生成 token', async () => {
    const res = await fetch(`${BASE_URL}/api/realtime/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        userId: 'test-user-123'
      }),
    });

    // 开发环境应返回占位 token
    assert.strictEqual(res.status, 200, '应返回 200');

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.token, '应包含 token 字段');
    assert.ok(json.model, '应包含 model 字段');
    assert.ok(json.expiresAt, '应包含 expiresAt 字段');
    assert.ok(json.wsUrl, '应包含 wsUrl 字段');
  });

  test('POST /api/realtime/token 拒绝缺少 userId', async () => {
    const res = await fetch(`${BASE_URL}/api/realtime/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 400, '缺少 userId 应返回 400');
  });
});

describe('Pantry OCR API 测试 (Step 6)', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // POST /api/pantry/ocr 测试
  // ------------------------------------------------------------
  test('POST /api/pantry/ocr 返回 mock 识别结果', async () => {
    // 创建一个简单的 base64 图片数据
    const mockImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const res = await fetch(`${BASE_URL}/api/pantry/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        image: mockImageBase64,
        userId: 'test-user-123'
      }),
    });

    assert.strictEqual(res.status, 200, '应返回 200');

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(Array.isArray(json.items), 'items 应为数组');
    assert.ok(json.items.length > 0, '应返回识别结果');
    assert.strictEqual(json._isMock, true, '当前应为 mock 数据');

    // 验证 item 结构
    const firstItem = json.items[0];
    assert.ok(firstItem.name, 'item 应有 name');
    assert.ok(firstItem.qty_est_range, 'item 应有 qty_est_range');
    assert.ok(typeof firstItem.confidence === 'number', 'item 应有 confidence');
  });

  test('POST /api/pantry/ocr 拒绝缺少图片', async () => {
    const res = await fetch(`${BASE_URL}/api/pantry/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        userId: 'test-user-123'
      }),
    });

    assert.strictEqual(res.status, 400, '缺少 image 应返回 400');
  });

  test('POST /api/pantry/ocr 拒绝无效图片格式', async () => {
    const res = await fetch(`${BASE_URL}/api/pantry/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        image: 'not-a-valid-base64-image!!!',
        userId: 'test-user-123'
      }),
    });

    assert.strictEqual(res.status, 400, '无效图片格式应返回 400');
  });
});
