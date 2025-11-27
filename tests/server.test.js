/**
 * mcp-server 基础路由与 CORS 测试
 *
 * 使用 Node.js 内置 test runner（Node 20+）
 * 通过 fork 子进程启动服务器，用原生 fetch 发请求
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
        // 测试用 mock 环境变量
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('listening') && !started) {
        started = true;
        // 给服务器一点时间完全就绪
        setTimeout(resolve, 100);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('Server stderr:', data.toString());
    });

    serverProcess.on('error', reject);

    // 超时保护
    setTimeout(() => {
      if (!started) {
        reject(new Error('Server failed to start within timeout'));
      }
    }, 5000);
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

