/**
 * Metrics 中间件
 *
 * 收集请求指标，暴露 /metrics 端点（Prometheus 文本格式）。
 * 为 Step 11 可观测性预埋。
 */

// =============================================================================
// 指标存储
// =============================================================================

/** @type {Map<string, number>} 请求计数（按路由） */
const requestCounts = new Map();

/** @type {Map<string, number[]>} 请求耗时（按路由，毫秒） */
const requestDurations = new Map();

/** @type {Map<string, number>} 工具超时计数 */
const toolTimeouts = new Map();

/** @type {Map<string, number>} Schema 校验失败计数 */
const schemaViolations = new Map();

// 预留指标
let leftoverConsumptionCount = 0;
let leftoverTotalCount = 0;

// =============================================================================
// 指标收集
// =============================================================================

/**
 * 规范化路由路径（去除动态参数）
 * @param {string} path - 原始路径
 * @returns {string} 规范化路径
 */
function normalizePath(path) {
  // 将 UUID 参数替换为 :id
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

/**
 * 记录请求
 * @param {string} method - HTTP 方法
 * @param {string} path - 请求路径
 * @param {number} durationMs - 耗时（毫秒）
 * @param {number} statusCode - 状态码
 */
export function recordRequest(method, path, durationMs, statusCode) {
  const normalizedPath = normalizePath(path);
  const key = `${method} ${normalizedPath}`;

  // 计数
  requestCounts.set(key, (requestCounts.get(key) || 0) + 1);

  // 耗时（保留最近 1000 个样本）
  const durations = requestDurations.get(key) || [];
  durations.push(durationMs);
  if (durations.length > 1000) {
    durations.shift();
  }
  requestDurations.set(key, durations);
}

/**
 * 记录工具超时
 * @param {string} toolName - 工具名称
 */
export function recordToolTimeout(toolName) {
  toolTimeouts.set(toolName, (toolTimeouts.get(toolName) || 0) + 1);
}

/**
 * 记录 Schema 校验失败
 * @param {string} endpoint - 端点
 */
export function recordSchemaViolation(endpoint) {
  schemaViolations.set(endpoint, (schemaViolations.get(endpoint) || 0) + 1);
}

/**
 * 记录剩菜消费
 * @param {boolean} consumed - 是否被消费
 */
export function recordLeftoverConsumption(consumed) {
  leftoverTotalCount++;
  if (consumed) {
    leftoverConsumptionCount++;
  }
}

// =============================================================================
// Metrics 中间件
// =============================================================================

/**
 * Metrics 收集中间件
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function metricsMiddleware(req, res, next) {
  const startTime = Date.now();

  // 监听响应完成
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    recordRequest(req.method, req.path, duration, res.statusCode);
  });

  next();
}

// =============================================================================
// Metrics 端点处理器
// =============================================================================

/**
 * 计算百分位数
 * @param {number[]} values - 数值数组
 * @param {number} percentile - 百分位（0-100）
 * @returns {number}
 */
function calculatePercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * 生成 Prometheus 格式的指标
 * @returns {string}
 */
function generatePrometheusMetrics() {
  const lines = [];

  // 帮助信息
  lines.push('# HELP weeknight_request_total Total number of HTTP requests');
  lines.push('# TYPE weeknight_request_total counter');

  // 请求计数
  for (const [key, count] of requestCounts) {
    const [method, path] = key.split(' ');
    lines.push(`weeknight_request_total{method="${method}",path="${path}"} ${count}`);
  }

  // 请求耗时分布
  lines.push('');
  lines.push('# HELP weeknight_request_duration_ms_p50 Request duration P50 in milliseconds');
  lines.push('# TYPE weeknight_request_duration_ms_p50 gauge');
  lines.push('# HELP weeknight_request_duration_ms_p90 Request duration P90 in milliseconds');
  lines.push('# TYPE weeknight_request_duration_ms_p90 gauge');
  lines.push('# HELP weeknight_request_duration_ms_p99 Request duration P99 in milliseconds');
  lines.push('# TYPE weeknight_request_duration_ms_p99 gauge');

  for (const [key, durations] of requestDurations) {
    const [method, path] = key.split(' ');
    const p50 = calculatePercentile(durations, 50);
    const p90 = calculatePercentile(durations, 90);
    const p99 = calculatePercentile(durations, 99);
    lines.push(`weeknight_request_duration_ms_p50{method="${method}",path="${path}"} ${p50}`);
    lines.push(`weeknight_request_duration_ms_p90{method="${method}",path="${path}"} ${p90}`);
    lines.push(`weeknight_request_duration_ms_p99{method="${method}",path="${path}"} ${p99}`);
  }

  // 工具超时
  lines.push('');
  lines.push('# HELP weeknight_tool_timeout_total Tool timeout count');
  lines.push('# TYPE weeknight_tool_timeout_total counter');
  for (const [tool, count] of toolTimeouts) {
    lines.push(`weeknight_tool_timeout_total{tool="${tool}"} ${count}`);
  }

  // Schema 校验失败
  lines.push('');
  lines.push('# HELP weeknight_schema_violation_total Schema violation count');
  lines.push('# TYPE weeknight_schema_violation_total counter');
  for (const [endpoint, count] of schemaViolations) {
    lines.push(`weeknight_schema_violation_total{endpoint="${endpoint}"} ${count}`);
  }

  // 剩菜消费率
  lines.push('');
  lines.push('# HELP weeknight_leftover_consumption_rate Leftover consumption rate');
  lines.push('# TYPE weeknight_leftover_consumption_rate gauge');
  const rate = leftoverTotalCount > 0 ? leftoverConsumptionCount / leftoverTotalCount : 0;
  lines.push(`weeknight_leftover_consumption_rate ${rate.toFixed(4)}`);
  lines.push(`weeknight_leftover_consumed_total ${leftoverConsumptionCount}`);
  lines.push(`weeknight_leftover_total ${leftoverTotalCount}`);

  return lines.join('\n');
}

/**
 * Metrics 端点处理器
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 */
export function metricsHandler(_req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(generatePrometheusMetrics());
}

export default metricsMiddleware;

