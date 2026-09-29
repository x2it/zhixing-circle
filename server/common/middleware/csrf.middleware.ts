import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const CSRF_COOKIE_KEY = 'suda-csrf-token';
const CSRF_HEADER_KEY = 'x-suda-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF 防护（仅针对浏览器 cookie 会话场景）：
 *
 * - 安全方法（GET/HEAD/OPTIONS）直接放行；
 * - 携带 Authorization / X-API-Key 头的请求放行：API Key 客户端的凭证通过显式请求头传递，
 *   浏览器跨站请求不会自动携带，天然免疫 CSRF；
 * - 不带 Origin/Referer 的请求放行：浏览器发出的任何跨站/同源写请求都会自动携带
 *   Origin（POST 表单/fetch 均不例外），因此缺失该头的请求可判定为非浏览器客户端
 *   （App、CI 脚本等），不存在 CSRF 攻击面；
 * - 其余（浏览器 cookie 会话）执行 double-submit 校验：cookie 与 header 中的
 *   CSRF token 必须同时存在且一致，否则 403。
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    // API Key 客户端一律放行：凭证由调用方显式携带（头或 URL 参数），浏览器跨站请求
    // 不会自动附带，天然不存在 CSRF 攻击面。App/脚本若只走 ?api_key= 且带了 Origin，
    // 在此兜底放行，避免被误判为浏览器会话而 403（历史上表现为"同步不成功"）。
    if (
      req.headers['authorization'] ||
      req.headers['x-api-key'] ||
      typeof (req.query as Record<string, unknown>)?.api_key === 'string'
    ) {
      next();
      return;
    }
    if (req.headers['authorization'] || req.headers['x-api-key']) {
      next();
      return;
    }
    if (!req.headers['origin'] && !req.headers['referer']) {
      next();
      return;
    }
    const cookieToken = req.cookies?.[CSRF_COOKIE_KEY];
    const headerToken = req.headers[CSRF_HEADER_KEY] as string | undefined;
    if (!cookieToken) {
      res.status(403).send('Forbidden，csrf token not found in cookie.');
      return;
    }
    if (!headerToken) {
      res.status(403).send('Forbidden，csrf token not found in header.');
      return;
    }
    if (cookieToken !== headerToken) {
      res.status(403).send('Forbidden，csrf token not match.');
      return;
    }
    next();
  }
}
