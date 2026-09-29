import { Inject, Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, gt, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { users, sessions, recoveryCodes } from '@server/database/schema';
import { hashToken, SESSION_TTL_MS } from '@server/common/middleware/auth.middleware';

/** 连续失败次数上限 */
const MAX_LOGIN_FAILURES = 5;
/** 锁定时长（毫秒） */
const LOCK_DURATION_MS = 15 * 60 * 1000;
/** 恢复码数量 */
const RECOVERY_CODE_COUNT = 5;

interface LoginAttempt {
  fails: number;
  lockUntil: number;
}

export interface UserPublicInfo {
  id: string;
  username: string;
  displayName?: string;
  role: string;
}

@Injectable()
export class AuthService {
  /** 登录失败限速表（内存级, 重启即清零——足够防暴力破解） */
  private loginAttempts = new Map<string, LoginAttempt>();

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  // ===== 登录 =====

  async login(username: string, password: string): Promise<{ token: string; user: UserPublicInfo }> {
    const name = (username || '').trim().toLowerCase();
    if (!name || !password) {
      throw new BadRequestException('请输入用户名和密码');
    }

    this.checkLock(name);

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.username, name))
      .limit(1);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      this.recordFailure(name);
      throw new UnauthorizedException('用户名或密码错误');
    }

    this.clearFailures(name);
    const token = await this.createSession(user.id);
    return {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName ?? undefined, role: user.role },
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async getUserById(userId: string): Promise<UserPublicInfo> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('用户不存在');
    return { id: user.id, username: user.username, displayName: user.displayName ?? undefined, role: user.role };
  }

  /** 按会话 token 解析用户（/api/auth/status 用, 校验失败返回 null） */
  async resolveByToken(token: string): Promise<UserPublicInfo | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row) return null;
    return { id: row.id, username: row.username, displayName: row.displayName ?? undefined, role: row.role };
  }

  // ===== 修改密码 =====

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('新密码至少需要 8 位字符');
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException('用户不存在');
    if (!(await bcrypt.compare(oldPassword || '', user.passwordHash))) {
      throw new BadRequestException('原密码错误');
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await this.db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    // 改密后踢掉其它会话（保留当前会话由 controller 处理——当前会话 cookie 不变）
  }

  // ===== 恢复码找回 =====

  async recover(username: string, code: string, newPassword: string): Promise<void> {
    const name = (username || '').trim().toLowerCase();
    if (!name || !code || !newPassword) {
      throw new BadRequestException('请填写用户名、恢复码和新密码');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('新密码至少需要 8 位字符');
    }

    const [user] = await this.db.select().from(users).where(eq(users.username, name)).limit(1);
    if (!user) {
      // 不区分"用户不存在"与"恢复码错误"，避免枚举用户名
      throw new BadRequestException('用户名或恢复码不正确');
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const [rc] = await this.db
      .select()
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, user.id), eq(recoveryCodes.codeHash, codeHash), isNull(recoveryCodes.usedAt)))
      .limit(1);

    if (!rc) {
      throw new BadRequestException('用户名或恢复码不正确');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.db.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    // 恢复码一次性使用
    await this.db.update(recoveryCodes).set({ usedAt: new Date() }).where(eq(recoveryCodes.id, rc.id));
    // 踢掉所有会话
    await this.db.delete(sessions).where(eq(sessions.userId, user.id));
  }

  /** 当前用户剩余可用恢复码数量 */
  async getRecoveryStatus(userId: string): Promise<{ remaining: number }> {
    const rows = await this.db
      .select({ id: recoveryCodes.id })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
    return { remaining: rows.length };
  }

  /** 重新生成恢复码（旧的作废，明文仅此一次返回） */
  async regenerateRecoveryCodes(userId: string): Promise<{ codes: string[] }> {
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    const codes = await this.generateCodes(userId);
    return { codes };
  }

  private async generateCodes(userId: string): Promise<string[]> {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code = 'rc_' + crypto.randomBytes(10).toString('hex');
      codes.push(code);
      await this.db.insert(recoveryCodes).values({
        userId,
        codeHash: crypto.createHash('sha256').update(code).digest('hex'),
      });
    }
    return codes;
  }

  // ===== 会话管理 =====

  async createSession(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    return token;
  }

  // ===== 限速 =====

  private checkLock(username: string): void {
    const attempt = this.loginAttempts.get(username);
    if (attempt && attempt.lockUntil > Date.now()) {
      const minutes = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
      throw new ForbiddenException(`登录失败次数过多，账户已锁定，请 ${minutes} 分钟后再试`);
    }
  }

  private recordFailure(username: string): void {
    const attempt = this.loginAttempts.get(username) ?? { fails: 0, lockUntil: 0 };
    attempt.fails += 1;
    if (attempt.fails >= MAX_LOGIN_FAILURES) {
      attempt.lockUntil = Date.now() + LOCK_DURATION_MS;
      attempt.fails = 0;
    }
    this.loginAttempts.set(username, attempt);
  }

  private clearFailures(username: string): void {
    this.loginAttempts.delete(username);
  }
}
