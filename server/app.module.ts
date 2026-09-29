import { APP_FILTER } from '@nestjs/core';
import { Module, RequestMethod, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AuthMiddleware } from './common/middleware/auth.middleware';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';
import { ViewModule } from './modules/view/view.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { TagsModule } from './modules/tags/tags.module';
import { FollowupsModule } from './modules/followups/followups.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DataModule } from './modules/data/data.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { BatchesModule } from './modules/batches/batches.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { SkillMdModule } from './modules/skill-md/skill-md.module';
import { MessagesModule } from './modules/messages/messages.module';
import { CallsModule } from './modules/calls/calls.module';
import { MomentsModule } from './modules/moments/moments.module';
import { TalkScriptsModule } from './modules/talk-scripts/talk-scripts.module';
import { SyncStatusModule } from './modules/sync-status/sync-status.module';
import { SyncUploadModule } from './modules/sync-upload/sync-upload.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    // enableCsrf: false —— 关闭平台全局 CSRF，由自建 CsrfMiddleware 接管：
    // 浏览器会话仍受 double-submit 保护，API Key / 非浏览器客户端豁免（可正常调用写接口）
    PlatformModule.forRoot({ enableCsrf: false }),
    // ====== @route-section: business-modules START ======
    // Place all business modules here.Do NOT add fallback modules here.
    ContactsModule,
    TagsModule,
    FollowupsModule,
    DashboardModule,
    DataModule,
    AuthModule,
    ApiKeysModule,
    BatchesModule,
    TemplatesModule,
    SkillMdModule,
    MessagesModule,
    CallsModule,
    MomentsModule,
    TalkScriptsModule,
    SyncStatusModule,
    SyncUploadModule,
    HealthModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // CSRF 防护 + 统一鉴权：浏览器会话写请求需 CSRF 校验；API Key 与非浏览器客户端豁免 CSRF
    consumer
      .apply(CsrfMiddleware, AuthMiddleware)
      .forRoutes({ path: '/api/*', method: RequestMethod.ALL });
  }
}
