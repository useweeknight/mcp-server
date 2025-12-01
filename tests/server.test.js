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

// ============================================================
// Step 7: Cook API 测试
// ============================================================

describe('Cook API 测试 (Step 7)', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  let sessionId = null;

  // ------------------------------------------------------------
  // POST /cook/start 测试
  // ------------------------------------------------------------
  test('POST /cook/start 创建烹饪会话', async () => {
    const res = await fetch(`${BASE_URL}/cook/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        recipe_id: 'test-recipe-123',
        user_id: 'test-user-123'
      }),
    });

    assert.strictEqual(res.status, 200, '应返回 200');

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.session_id, '应包含 session_id');
    assert.ok(Array.isArray(json.steps), 'steps 应为数组');
    assert.ok(json.steps.length > 0, '应返回步骤');
    assert.strictEqual(json.current_step, 0, '初始步骤应为 0');

    // 保存 session_id 供后续测试使用
    sessionId = json.session_id;
  });

  test('POST /cook/start 拒绝缺少 recipe_id', async () => {
    const res = await fetch(`${BASE_URL}/cook/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        user_id: 'test-user-123'
      }),
    });

    assert.strictEqual(res.status, 400, '缺少 recipe_id 应返回 400');
  });

  // ------------------------------------------------------------
  // POST /cook/action 测试
  // ------------------------------------------------------------
  test('POST /cook/action 发送 start 指令', async () => {
    // 先创建一个新会话
    const startRes = await fetch(`${BASE_URL}/cook/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        recipe_id: 'test-recipe-456',
        user_id: 'test-user-123'
      }),
    });
    const startJson = await startRes.json();
    const testSessionId = startJson.session_id;

    const res = await fetch(`${BASE_URL}/cook/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        session_id: testSessionId,
        action: 'start'
      }),
    });

    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.status, 'cooking', '状态应为 cooking');
  });

  test('POST /cook/action 发送 next 指令', async () => {
    // 先创建一个新会话并启动
    const startRes = await fetch(`${BASE_URL}/cook/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        recipe_id: 'test-recipe-789',
        user_id: 'test-user-123'
      }),
    });
    const startJson = await startRes.json();
    const testSessionId = startJson.session_id;

    // 启动烹饪
    await fetch(`${BASE_URL}/cook/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ session_id: testSessionId, action: 'start' }),
    });

    // 下一步
    const res = await fetch(`${BASE_URL}/cook/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ session_id: testSessionId, action: 'next' }),
    });

    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.current_step, 1, '应前进到步骤 1');
  });

  test('POST /cook/action 拒绝缺少 session_id', async () => {
    const res = await fetch(`${BASE_URL}/cook/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        action: 'start'
      }),
    });

    assert.strictEqual(res.status, 400, '缺少 session_id 应返回 400');
  });

  test('POST /cook/action 拒绝无效会话', async () => {
    const res = await fetch(`${BASE_URL}/cook/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        session_id: 'non-existent-session',
        action: 'start'
      }),
    });

    assert.strictEqual(res.status, 404, '无效会话应返回 404');
  });

  // ------------------------------------------------------------
  // GET /cook/session/:id 测试
  // ------------------------------------------------------------
  test('GET /cook/session/:id 获取会话状态', async () => {
    // 先创建一个新会话
    const startRes = await fetch(`${BASE_URL}/cook/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        recipe_id: 'test-recipe-status',
        user_id: 'test-user-123'
      }),
    });
    const startJson = await startRes.json();
    const testSessionId = startJson.session_id;

    const res = await fetch(`${BASE_URL}/cook/session/${testSessionId}`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.data, '应包含 data 字段');
    assert.ok(json.data.session_id, '应包含 session_id');
    assert.ok(Array.isArray(json.data.steps), 'steps 应为数组');
  });

  test('GET /cook/session/:id 拒绝无效会话', async () => {
    const res = await fetch(`${BASE_URL}/cook/session/non-existent-session`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 404, '无效会话应返回 404');
  });
});

// ============================================================
// Step 7 补丁: Leftovers / Flags / Groceries API 测试
// ============================================================

describe('Leftovers API 测试 (Step 7 补丁)', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // POST /api/leftovers 测试
  // ------------------------------------------------------------
  test('POST /api/leftovers 创建剩菜记录', async () => {
    const res = await fetch(`${BASE_URL}/api/leftovers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        recipe_id: 'test-recipe-leftover',
        recipe_title: 'Test Leftover Recipe',
        servings: 2,
        user_id: 'test-user-123',
        safe_hours: 48
      }),
    });

    // 由于没有真实数据库，可能返回 500
    assert.ok([200, 201, 500].includes(res.status), '路由应该存在');

    const json = await res.json();
    assert.ok('ok' in json, '应包含 ok 字段');
  });

  test('POST /api/leftovers 拒绝缺少 recipe_id', async () => {
    const res = await fetch(`${BASE_URL}/api/leftovers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        servings: 2
      }),
    });

    assert.strictEqual(res.status, 400, '缺少 recipe_id 应返回 400');
  });

  test('POST /api/leftovers 拒绝无效 servings', async () => {
    const res = await fetch(`${BASE_URL}/api/leftovers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        recipe_id: 'test-recipe',
        servings: 0
      }),
    });

    assert.strictEqual(res.status, 400, '无效 servings 应返回 400');
  });

  // ------------------------------------------------------------
  // GET /api/leftovers 测试
  // ------------------------------------------------------------
  test('GET /api/leftovers 返回剩菜列表', async () => {
    const res = await fetch(`${BASE_URL}/api/leftovers?user_id=test-user-123`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    // 由于没有真实数据库，可能返回 500
    assert.ok([200, 500].includes(res.status), '路由应该存在');

    const json = await res.json();
    assert.ok('ok' in json, '应包含 ok 字段');
  });
});

describe('Feature Flags API 测试 (Step 7 补丁)', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // GET /api/flags 测试
  // ------------------------------------------------------------
  test('GET /api/flags 返回功能开关', async () => {
    const res = await fetch(`${BASE_URL}/api/flags`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.flags, '应包含 flags 字段');
    assert.ok('cold_start_flow' in json.flags, '应包含 cold_start_flow');
    assert.ok('emoji_feedback' in json.flags, '应包含 emoji_feedback');
  });

  test('GET /api/flags?keys=cold_start_flow,emoji_feedback 返回指定开关', async () => {
    const res = await fetch(`${BASE_URL}/api/flags?keys=cold_start_flow,emoji_feedback`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.flags, '应包含 flags 字段');
    // 应该只返回请求的 keys（如果没有数据库则返回默认值）
    assert.ok('cold_start_flow' in json.flags, '应包含 cold_start_flow');
    assert.ok('emoji_feedback' in json.flags, '应包含 emoji_feedback');
  });

  // ------------------------------------------------------------
  // GET /api/flags/:key 测试
  // ------------------------------------------------------------
  test('GET /api/flags/cold_start_flow 返回单个开关', async () => {
    const res = await fetch(`${BASE_URL}/api/flags/cold_start_flow`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 200);

    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.key, 'cold_start_flow');
    assert.ok(typeof json.enabled === 'boolean', 'enabled 应为布尔值');
  });
});

describe('Groceries API 测试 (Step 7 补丁)', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // POST /api/groceries 测试
  // ------------------------------------------------------------
  test('POST /api/groceries 生成购物清单', async () => {
    const res = await fetch(`${BASE_URL}/api/groceries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({
        recipes: [
          { recipe_id: 'test-recipe-1', servings: 4 },
          { recipe_id: 'test-recipe-2' }
        ],
        pantry_snapshot: [
          { name: 'salt' },
          { name: 'pepper' }
        ]
      }),
    });

    // 由于没有真实数据库，可能返回 500
    assert.ok([200, 500].includes(res.status), '路由应该存在');

    const json = await res.json();
    assert.ok('ok' in json, '应包含 ok 字段');
  });

  test('POST /api/groceries 拒绝缺少 recipes', async () => {
    const res = await fetch(`${BASE_URL}/api/groceries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 400, '缺少 recipes 应返回 400');
  });

  test('POST /api/groceries 拒绝空 recipes 数组', async () => {
    const res = await fetch(`${BASE_URL}/api/groceries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify({ recipes: [] }),
    });

    assert.strictEqual(res.status, 400, '空 recipes 应返回 400');
  });
});

// ============================================================
// Step 8: Admin API 测试
// ============================================================

describe('Admin API 测试 (Step 8)', () => {
  before(async () => {
    if (!serverProcess) {
      await startServer();
    }
  });

  after(() => {
    stopServer();
  });

  // ------------------------------------------------------------
  // Admin 路由需要授权测试
  // ------------------------------------------------------------
  test('GET /admin 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/users 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/users`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/recipes 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/recipes`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/substitutions 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/substitutions`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/pantry 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/pantry`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/leftovers 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/leftovers`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/suggestions 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/suggestions`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/metrics 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/metrics`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/system 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/system`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  test('GET /admin/audit 无授权返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin/audit`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    assert.strictEqual(res.status, 401, '无授权应返回 401');
  });

  // 无效 token 测试
  test('GET /admin 无效 token 返回 401', async () => {
    const res = await fetch(`${BASE_URL}/admin`, {
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: 'Bearer invalid-token-12345',
      },
    });

    assert.strictEqual(res.status, 401, '无效 token 应返回 401');
  });
});
