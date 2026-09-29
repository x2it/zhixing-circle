import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { exec } from 'child_process';
import * as express from 'express';
import { __express as hbsExpressEngine } from 'hbs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

/**
 * 进程内 PostgreSQL 看门狗。
 * 背景：沙箱休眠会冻结/杀死全部进程（含独立的 shell 看门狗），恢复后只有平台守护的应用进程被拉起，
 * 导致 PG 无人拉起、全站 500。把看门狗嵌进应用进程：只要应用活着（平台保证），PG 就有人看管。
 */
function startPgWatchdog(logger: Logger): void {
  const host = process.env.PGWATCH_HOST || '127.0.0.1';
  const port = process.env.PGWATCH_PORT || '5432';
  let recovering = false;

  const check = (): void => {
    if (recovering) return;
    exec(`pg_isready -h ${host} -p ${port} -q`, { timeout: 8000 }, (err) => {
      if (!err) return;
      recovering = true;
      logger.warn(`PG unreachable, attempting auto-restart...`);
      exec('service postgresql start', { timeout: 20000 }, (startErr) => {
        recovering = false;
        if (startErr) {
          logger.error(`PG auto-restart failed: ${startErr.message}`);
        } else {
          logger.log('PG auto-restart issued');
        }
      });
    });
  };

  check();
  setInterval(check, 30_000);
  logger.log('In-process PG watchdog started (interval 30s)');
}

async function bootstrap() {
  // bodyParser 手动注册：Nest/express 默认仅 100kb，批量同步（500 条/批的短信/通话/联系人）
  // 的 JSON 体积常超过该上限而被 413 拒绝，历史上表现为"上传不成功"。
  // 这里放宽到 20mb，并同时覆盖 urlencoded 表单。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
    bodyParser: false,
  });
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));
  // 自托管前端构建产物: 平台 CDN 不存在时, 由本服务直接提供 /assets 静态资源
  const clientDir = join(process.cwd(), 'dist/client');
  app.use('/assets', express.static(join(clientDir, 'assets')));
  // 自定义域名模式: 注入 x-miaoda-custom-host, 让前端 basename 解析为根路径 "/" (否则前端拿到 /app/ 前缀, 根路径下路由不匹配导致白屏)
  app.use(((req: { headers: Record<string, string | undefined> }, _res: unknown, next: () => void) => {
    req.headers['x-miaoda-custom-host'] = req.headers.host || 'localhost';
    next();
  }) as express.RequestHandler);
  await configureApp(app, {
    disableSwagger: true,
  });
  const logger = new Logger('Bootstrap');
  const host = process.env.SERVER_HOST || 'localhost';
  const port = Number(process.env.SERVER_PORT || '3000');

  // 注册视图引擎, 渲染 client 目录下的 html 文件 (vite 产物位于 dist/client/client/)
  app.setBaseViewsDir(join(clientDir, 'client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
  startPgWatchdog(logger);
}

bootstrap();
