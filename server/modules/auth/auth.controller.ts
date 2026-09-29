import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SESSION_TTL_MS } from '@server/common/middleware/auth.middleware';
import { UserContext } from '@server/common/context/user-context';

interface LoginBody {
  username?: string;
  password?: string;
}

interface ChangePasswordBody {
  oldPassword?: string;
  newPassword?: string;
}

interface RecoverBody {
  username?: string;
  code?: string;
  newPassword?: string;
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** 登录（白名单） */
  @Post('login')
  async login(
    @Body() body: LoginBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.login(body.username || '', body.password || '');
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
    return { success: true, user };
  }

  /** 退出登录（白名单不适用——未登录也允许调） */
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(readCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true };
  }

  /** 会话探测（白名单）：前端启动时判断是否已登录 */
  @Get('status')
  async status(@Req() req: Request) {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      // 借助 AuthService 走数据库校验（复用 resolveSession 逻辑较繁琐，直接查）
      const user = await this.authService['resolveByToken'](token).catch(() => null);
      if (user) {
        return { authenticated: true, user };
      }
    }
    return { authenticated: false };
  }

  /** 当前用户信息（需登录） */
  @Get('me')
  async me() {
    const ctx = UserContext.get();
    if (!ctx) throw new UnauthorizedException('未登录');
    return this.authService.getUserById(ctx.userId);
  }

  /** 修改密码（需登录） */
  @Post('change-password')
  async changePassword(@Body() body: ChangePasswordBody) {
    const ctx = UserContext.get();
    if (!ctx) throw new UnauthorizedException('未登录');
    await this.authService.changePassword(ctx.userId, body.oldPassword || '', body.newPassword || '');
    return { success: true };
  }

  /** 恢复码重置密码（白名单） */
  @Post('recover')
  async recover(@Body() body: RecoverBody) {
    await this.authService.recover(body.username || '', body.code || '', body.newPassword || '');
    return { success: true };
  }

  /** 查询剩余恢复码数量（需登录） */
  @Get('recovery-codes')
  async recoveryCodes() {
    const ctx = UserContext.get();
    if (!ctx) throw new UnauthorizedException('未登录');
    return this.authService.getRecoveryStatus(ctx.userId);
  }

  /** 重新生成恢复码（需登录, 明文仅返回一次） */
  @Post('recovery-codes/regenerate')
  async regenerateRecoveryCodes() {
    const ctx = UserContext.get();
    if (!ctx) throw new UnauthorizedException('未登录');
    return this.authService.regenerateRecoveryCodes(ctx.userId);
  }
}
