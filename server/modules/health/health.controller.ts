import { Controller, Get, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';

/**
 * 健康检查端点（免鉴权，用于 uptime 监控 / 发布后自检）
 * - GET /api/health          → 进程存活
 * - GET /api/health/deep     → 进程 + 数据库连通性
 */
@Controller('api/health')
export class HealthController {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  @Get()
  async check(): Promise<{ status: string; timestamp: string; uptime: number }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }

  @Get('deep')
  async deep(): Promise<{ status: string; database: string; timestamp: string }> {
    let database = 'down';
    try {
      await this.db.execute(sql`SELECT 1`);
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
