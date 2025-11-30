/**
 * Trace ID 中间件
 *
 * 为每个请求生成唯一的追踪 ID，用于日志关联和调试。
 * ID 格式：wn-{timestamp}-{random}
 */

import { randomBytes } from 'crypto';

/**
 * 生成追踪 ID
 * @returns {string} 追踪 ID
 */
function generateTraceId() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `wn-${timestamp}-${random}`;
}

/**
 * Trace ID 中间件
 * - 从请求头 x-trace-id 读取（如果存在）
 * - 否则生成新的追踪 ID
 * - 注入到 req.traceId 和响应头
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function traceIdMiddleware(req, res, next) {
  // 优先使用请求头中的 trace-id（支持分布式追踪）
  const existingTraceId = req.headers['x-trace-id'];
  const traceId = typeof existingTraceId === 'string' && existingTraceId
    ? existingTraceId
    : generateTraceId();

  // 注入到请求对象
  req.traceId = traceId;

  // 设置响应头
  res.setHeader('x-trace-id', traceId);

  next();
}

export default traceIdMiddleware;

