import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { tags, contactTags, contacts } from '@server/database/schema';
import { eq, asc, and, sql } from 'drizzle-orm';
import type { Tag, CreateTagRequest, UpdateTagRequest } from '@shared/api.interface';
import { UserContext } from '@server/common/context/user-context';

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async findAll(): Promise<Tag[]> {
    const userId = UserContext.getUserId();
    const rows = await this.db
      .select()
      .from(tags)
      .where(eq(tags.userId, userId))
      .orderBy(asc(tags.sortOrder), asc(tags.name));
    return rows.map(row => this.mapToTag(row));
  }

  async findOne(id: string): Promise<Tag> {
    const userId = UserContext.getUserId();
    const [row] = await this.db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundException('标签不存在');
    return this.mapToTag(row);
  }

  async create(dto: CreateTagRequest): Promise<Tag> {
    const userId = UserContext.getUserId();
    const [row] = await this.db
      .insert(tags)
      .values({
        userId,
        name: dto.name,
        category: dto.category,
        color: dto.color,
        sortOrder: dto.sortOrder,
      })
      .returning();
    return this.mapToTag(row);
  }

  async update(id: string, dto: UpdateTagRequest): Promise<Tag> {
    const userId = UserContext.getUserId();
    const patch: Partial<typeof tags.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    const [row] = await this.db
      .update(tags)
      .set(patch)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .returning();

    if (!row) {
      throw new NotFoundException('标签不存在');
    }

    return this.mapToTag(row);
  }

  async remove(id: string): Promise<void> {
    const userId = UserContext.getUserId();
    // 确认标签属于当前用户
    const [owned] = await this.db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .limit(1);
    if (!owned) {
      throw new NotFoundException('标签不存在');
    }

    // 仅删除属于当前用户的关联记录（参数化子查询, 防止跨用户越权）
    await this.db.execute(
      sql`DELETE FROM contact_tags WHERE tag_id = ${id} AND contact_id IN (SELECT id FROM contacts WHERE user_id = ${userId})`,
    );

    const result = await this.db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .returning({ id: tags.id });

    if (result.length === 0) {
      throw new NotFoundException('标签不存在');
    }
  }

  private mapToTag(row: typeof tags.$inferSelect): Tag {
    return {
      id: row.id,
      name: row.name,
      category: row.category as Tag['category'],
      color: row.color ?? '#64748b',
      sortOrder: row.sortOrder ?? 0,
    };
  }
}
