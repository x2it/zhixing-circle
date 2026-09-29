import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { systemSettings, tags } from '@server/database/schema';
import { eq, like, asc, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { UserContext } from '@server/common/context/user-context';
import type {
  ContactTemplate,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  DuplicateTemplateRequest,
  ResetAllTemplatesRequest,
  ApplyTemplateResponse,
  TemplateApplyReport,
  TemplateTier,
  TemplateTag,
  NicknameFormatConfig,
} from '@shared/api.interface';

const TEMPLATE_KEY_PREFIX = 'template_';
/** apply 前的生效配置快照（按用户隔离）：记录「最近一次应用模板之前」的分层与昵称配置 */
const APPLIED_SNAPSHOT_PREFIX = 'applied_template_snapshot:';

const DEFAULT_COLORS = {
  S: '#0f172a',
  A: '#1e293b',
  B: '#334155',
  C: '#64748b',
  D: '#94a3b8',
  V: '#059669',
};

function buildTiers(values: string[], labels: string[], descriptions: string[]): TemplateTier[] {
  return values.map((v, i) => ({
    value: v,
    label: labels[i],
    description: descriptions[i],
    color: DEFAULT_COLORS[v as keyof typeof DEFAULT_COLORS] || '#64748b',
    sortOrder: i,
  }));
}

function buildTags(names: string[], colors: string[]): TemplateTag[] {
  return names.map((n, i) => ({
    name: n,
    color: colors[i % colors.length],
    sortOrder: i,
  }));
}

/** 系统出厂分层（与从未应用模板时的默认行为、数据库初始 contact_tiers 完全一致） */
const FACTORY_TIERS: TemplateTier[] = buildTiers(
  ['S', 'A', 'B', 'C', 'D', 'V'],
  ['S 级', 'A 级', 'B 级', 'C 级', 'D 级', 'V 级'],
  ['核心关系', '重要关系', '普通朋友', '认识的人', '弱关系', '已维护关系'],
);

/** JSON 深拷贝（模板内容均为可 JSON 序列化数据） */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const IDENTITY_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1'];
const ATTRIBUTE_COLORS = ['#64748b', '#475569', '#334155', '#1e293b', '#0f172a', '#6366f1', '#8b5cf6'];

const PRESET_TEMPLATES: ContactTemplate[] = [
  {
    id: 'preset-real-estate',
    name: '我是Davi',
    description: '基于 Davi 的实际业务定制的客户分层与标签体系（房产经纪场景）',
    isPreset: true,
    tiers: buildTiers(
      ['S', 'A', 'B', 'C', 'D', 'V'],
      ['S 级', 'A 级', 'B 级', 'C 级', 'D 级', 'V 级'],
      ['成交高价值客户', '高意向客户', '已接触客户', '信息完整客户', '线索客户', '已成交售后客户'],
    ),
    identityTags: buildTags(
      [
        // 客源 · 意向
        '要买房子的客户',
        '要租房子的客户',
        '都是客户',
        // 客源 · 已成交
        '售房成交客户',
        '成交了的租房客户',
        '成交了其他业务的客户',
        // 房源 · 业主/房东
        '有房子要卖的房东',
        '有房子要租的业主',
        '都是房东',
        '悦中心业主',
        // 同行 · 经纪人
        '新亚经纪人',
        '荣城经纪人',
        '尊园经纪人',
        '普洱房产经纪人',
        '贝壳经纪人',
        '置业顾问',
        '优居平台经纪人',
        '房产相关从业',
        // 同行 · 炒房/托管
        '抬房炒房',
        '搞租房民宿的托管公司或个人',
        // 渠道与服务
        '房产相关渠道及驻场',
        '装修与建材',
        '家政保洁搬家开锁等',
        // 门店与组织
        '优居同德店',
        '发哥的门店',
        '昆明优居总部',
        '开公司相关事务',
        '蛟龙竞跃训战营（融合训）',
        // 私人圈
        '家人们',
        '朋友们',
        '泛泛之交',
        '未设置标签的朋友',
        // 特殊
        '我是Davi',
      ],
      IDENTITY_COLORS,
    ),
    attributeTags: buildTags(
      [
        // 跟进状态（微信标签之外的过程属性）
        '高意向',
        '急售急租',
        '已带看',
        '议价中',
        '独家委托',
        '转介绍',
        '可合作',
        // 需求/房源类型（原属性保留）
        '学区房',
        '地铁房',
        '刚需',
        '改善型',
        '投资',
        '首套',
        '二套',
      ],
      ATTRIBUTE_COLORS,
    ),
    fields: [
      // 客源侧
      { key: 'intentDistrict', label: '意向区域', type: 'text', group: 'business', sortOrder: 0, placeholder: '如：悦中心 / 同德片区' },
      { key: 'buyBudget', label: '购房预算', type: 'number', group: 'business', sortOrder: 1, placeholder: '单位：万元' },
      { key: 'rentBudget', label: '租金预算', type: 'number', group: 'business', sortOrder: 2, placeholder: '单位：元/月' },
      { key: 'houseType', label: '意向房型', type: 'select', options: ['新房', '二手房', '公寓', '别墅', '商铺'], group: 'business', sortOrder: 3 },
      { key: 'housePurpose', label: '购房目的', type: 'select', options: ['刚需', '改善', '投资', '学区', '养老'], group: 'business', sortOrder: 4 },
      { key: 'decisionMaker', label: '决策人', type: 'select', options: ['本人', '配偶', '父母', '共同决策'], group: 'business', sortOrder: 5 },
      // 业主/房源侧
      { key: 'propertyAddress', label: '房源地址', type: 'text', group: 'business', sortOrder: 6, placeholder: '业主房源：小区 / 楼盘' },
      { key: 'propertyArea', label: '房源面积', type: 'number', group: 'business', sortOrder: 7, placeholder: '单位：㎡' },
      { key: 'expectPrice', label: '期望售价', type: 'number', group: 'business', sortOrder: 8, placeholder: '单位：万元' },
      { key: 'expectRent', label: '期望租金', type: 'number', group: 'business', sortOrder: 9, placeholder: '单位：元/月' },
      // 成交
      { key: 'dealType', label: '成交类型', type: 'select', options: ['售房成交', '租房成交', '其他业务'], group: 'business', sortOrder: 10 },
      { key: 'dealDate', label: '成交日期', type: 'date', group: 'business', sortOrder: 11 },
      // 备注
      { key: 'visitNote', label: '带看记录', type: 'textarea', group: 'note', sortOrder: 12 },
    ],
    nicknameFormat: {
      description: '层级·称呼（关键信息）',
      useTierPrefix: true,
      tierSeparator: '·',
      useKeyInfoBrackets: true,
      nonClientPrefixes: [
        { prefix: '同', label: '同行' },
      ],
      relationSuffixes: [
        { suffix: '租', label: '租客' },
        { suffix: '售', label: '卖房业主' },
      ],
      examples: [
        'A·张哥（要买悦中心）',
        'S·王姐（急售·同德）',
        'B·李哥（租房·悦中心业主）',
      ],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-insurance',
    name: '保险顾问模板',
    description: '按客户生命周期分层：线索 → 已接触 → 高意向 → 已提案 → 已成交 → 续保加保',
    isPreset: true,
    tiers: buildTiers(
      ['S', 'A', 'B', 'C', 'D', 'V'],
      ['已成交', '已提案', '高意向', '已接触', '线索', '续保加保'],
      ['完成首单承保，做服务与转介绍', '计划书已递交，待决策', '已确认需求与预算，正在对比方案', '已建立联系，未确认需求', '转介绍/名单，尚未接触', '老客户续期、加保'],
    ),
    identityTags: buildTags(
      ['企业主', '高管', '白领', '宝妈', '自由职业', '退休'],
      IDENTITY_COLORS,
    ),
    attributeTags: buildTags(
      ['重疾险', '医疗险', '寿险', '意外险', '年金险', '教育金', '养老险'],
      ATTRIBUTE_COLORS,
    ),
    fields: [
      { key: 'insuranceType', label: '险种意向', type: 'multiselect', options: ['重疾险', '医疗险', '寿险', '意外险', '年金险', '教育金', '养老险'], group: 'business', sortOrder: 0 },
      { key: 'annualBudget', label: '年缴预算', type: 'number', group: 'business', sortOrder: 1, placeholder: '单位：元' },
      { key: 'familyRole', label: '家庭角色', type: 'select', options: ['本人', '配偶', '子女', '父母'], group: 'business', sortOrder: 2 },
      { key: 'hasPolicy', label: '已有保单', type: 'boolean', group: 'business', sortOrder: 3 },
      { key: 'coverage', label: '保额需求', type: 'text', group: 'business', sortOrder: 4 },
      { key: 'healthNote', label: '健康告知', type: 'textarea', group: 'note', sortOrder: 5 },
    ],
    nicknameFormat: {
      description: '层级·称呼（关键信息）',
      useTierPrefix: true,
      tierSeparator: '·',
      useKeyInfoBrackets: true,
      nonClientPrefixes: [],
      relationSuffixes: [],
      examples: [
        'A·王总（企业主重疾）',
        'B·李姐（宝妈医疗险）',
        'S·张总（年金险）',
      ],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-ecommerce',
    name: '微商电商模板',
    description: '按 RFM 复购模型分层：潜在买家 → 首购 → 复购 → 大客户，代理分销单列',
    isPreset: true,
    tiers: buildTiers(
      ['S', 'A', 'B', 'C', 'D', 'V'],
      ['大客户', '复购客户', '首购客户', '潜在买家', '长期未动', '代理分销'],
      [
        '高客单/高毛利，重点维护',
        '已复购 2 次以上，信任建立',
        '已完成首单，待转复购',
        '咨询过，未下单',
        '超过 90 天无互动，待激活',
        '代理/分销商，走 B 端',
      ],
    ),
    identityTags: buildTags(
      ['代理', '分销', '零售客户', '潜在客户', '同行'],
      IDENTITY_COLORS,
    ),
    attributeTags: buildTags(
      ['护肤', '彩妆', '母婴', '保健品', '服装', '家居'],
      ATTRIBUTE_COLORS,
    ),
    fields: [
      { key: 'agentLevel', label: '代理等级', type: 'select', options: ['钻石', '金牌', '银牌', '普通'], group: 'business', sortOrder: 0 },
      { key: 'category', label: '主推品类', type: 'select', options: ['美妆', '服饰', '食品', '母婴', '数码', '家居'], group: 'business', sortOrder: 1 },
      { key: 'monthlyPurchase', label: '月均进货', type: 'number', group: 'business', sortOrder: 2, placeholder: '单位：元' },
      { key: 'repurchase', label: '复购频次', type: 'select', options: ['高频', '中频', '低频', '沉睡'], group: 'business', sortOrder: 3 },
      { key: 'channel', label: '渠道来源', type: 'select', options: ['抖音', '小红书', '微信', '线下', '转介绍'], group: 'business', sortOrder: 4 },
      { key: 'remark', label: '备注', type: 'textarea', group: 'note', sortOrder: 5 },
    ],
    nicknameFormat: {
      description: '层级·称呼（关键信息）',
      useTierPrefix: true,
      tierSeparator: '·',
      useKeyInfoBrackets: true,
      nonClientPrefixes: [
        { prefix: '代', label: '代理' },
        { prefix: '分', label: '分销' },
      ],
      relationSuffixes: [],
      examples: [
        '复购·张姐（护肤，月均 2 单）',
        '首购·李妹（母婴客户）',
        '代理·王总（金牌代理）',
      ],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-social',
    name: '自由社交模板',
    description: '按关系深浅分层：初识 → 熟识 → 好友 → 核心人脉，贵人导师与待唤醒单列',
    isPreset: true,
    tiers: buildTiers(
      ['S', 'A', 'B', 'C', 'D', 'V'],
      ['核心人脉', '好友', '熟识', '初识', '待唤醒', '贵人导师'],
      [
        '深度互信，可互相托付',
        '常来往，有实质互助',
        '认识且有过交流',
        '只加了好友，未深聊',
        '长期无联系，待激活',
        '资源型/提携型关系，定期请教',
      ],
    ),
    identityTags: buildTags(
      ['朋友', '同事', '家人', '同学', '同行', '兴趣圈'],
      IDENTITY_COLORS,
    ),
    attributeTags: buildTags(
      ['行业', '城市', '爱好', '资源'],
      ATTRIBUTE_COLORS,
    ),
    fields: [
      { key: 'circle', label: '关系圈层', type: 'select', options: ['核心', '常联系', '泛交', '新认识'], group: 'business', sortOrder: 0 },
      { key: 'interest', label: '兴趣爱好', type: 'multiselect', options: ['运动', '读书', '旅行', '美食', '影视', '投资'], group: 'business', sortOrder: 1 },
      { key: 'source', label: '认识渠道', type: 'select', options: ['朋友介绍', '活动', '线上', '同事', '同学'], group: 'business', sortOrder: 2 },
      { key: 'platform', label: '常联系平台', type: 'select', options: ['微信', '电话', '线下', '其他'], group: 'business', sortOrder: 3 },
      { key: 'city', label: '所在城市', type: 'text', group: 'business', sortOrder: 4 },
      { key: 'remark', label: '备注', type: 'textarea', group: 'note', sortOrder: 5 },
    ],
    nicknameFormat: {
      description: '层级·称呼（关键信息），非客户用前缀区分',
      useTierPrefix: true,
      tierSeparator: '·',
      useKeyInfoBrackets: true,
      nonClientPrefixes: [
        { prefix: '友', label: '朋友' },
        { prefix: '同', label: '同事/同学' },
        { prefix: '家', label: '家人' },
      ],
      relationSuffixes: [],
      examples: [
        '核心·张哥（产品经理，北京）',
        '好友·李姐（大学同学，上海）',
        '导师·王叔（深圳）',
      ],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-education',
    name: '教育培训模板',
    description: '按招生漏斗分层：线索 → 已体验 → 在读 → 已续费，转介绍与流失单列',
    isPreset: true,
    tiers: buildTiers(
      ['S', 'A', 'B', 'C', 'D', 'V'],
      ['已续费', '在读', '已体验', '线索', '流失', '转介绍'],
      [
        '已完成续费，忠诚度高，优先维护',
        '已报名在读，关注学习效果',
        '上过体验课，待转化报名',
        '留资未体验，待邀约',
        '体验后未报名/已退课',
        '老带新来源，给予回馈',
      ],
    ),
    identityTags: buildTags(
      ['学员本人', '家长', '试听家长', '老学员', '同行机构'],
      IDENTITY_COLORS,
    ),
    attributeTags: buildTags(
      ['幼少儿童', 'K12', '高中', '成人职教', '艺术类', '体育类', '语言类'],
      ATTRIBUTE_COLORS,
    ),
    fields: [
      { key: 'courseType', label: '报读课程', type: 'multiselect', options: ['语文', '数学', '英语', '物理', '化学', '艺术', '体育'], group: 'business', sortOrder: 0 },
      { key: 'grade', label: '当前年级', type: 'select', options: ['幼儿园', '小学', '初中', '高中', '成人'], group: 'business', sortOrder: 1 },
      { key: 'school', label: '就读学校', type: 'text', group: 'business', sortOrder: 2 },
      { key: 'trialDate', label: '体验课日期', type: 'date', group: 'business', sortOrder: 3 },
      { key: 'source', label: '来源渠道', type: 'select', options: ['地推', '转介绍', '线上广告', '公众号', '社群'], group: 'business', sortOrder: 4 },
      { key: 'remark', label: '备注', type: 'textarea', group: 'note', sortOrder: 5 },
    ],
    nicknameFormat: {
      description: '层级·称呼（关键信息）',
      useTierPrefix: true,
      tierSeparator: '·',
      useKeyInfoBrackets: true,
      nonClientPrefixes: [
        { prefix: '同', label: '同行' },
      ],
      relationSuffixes: [
        { suffix: '妈', label: '学员妈妈' },
        { suffix: '爸', label: '学员爸爸' },
      ],
      examples: [
        '在读·张小明妈（初三，数学）',
        '体验·李朵朵爸（小学，英语）',
        '续费·王浩然（高一，物理）',
      ],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'preset-local-service',
    name: '本地服务门店模板',
    description: '按到店与储值分层：新客 → 回头客 → 会员 → 储值大客户，流失预警单列',
    isPreset: true,
    tiers: buildTiers(
      ['S', 'A', 'B', 'C', 'D', 'V'],
      ['储值大客户', '会员', '回头客', '新客', '流失', '转介绍'],
      [
        '已储值/办卡，高粘性',
        '已办会员，有复购',
        '到店 2 次以上',
        '到店 1 次',
        '超过 90 天未到店',
        '老客推荐来源，给予回馈',
      ],
    ),
    identityTags: buildTags(
      ['门店客户', '线上下单', '周边居民', '企业客户', '同行'],
      IDENTITY_COLORS,
    ),
    attributeTags: buildTags(
      ['美业', '餐饮', '健身', '家政', '维修', '宠物'],
      ATTRIBUTE_COLORS,
    ),
    fields: [
      { key: 'cardType', label: '卡项', type: 'select', options: ['次卡', '月卡', '季卡', '年卡', '储值卡'], group: 'business', sortOrder: 0 },
      { key: 'balance', label: '剩余金额/次数', type: 'text', group: 'business', sortOrder: 1 },
      { key: 'lastVisit', label: '最近到店', type: 'date', group: 'business', sortOrder: 2 },
      { key: 'preference', label: '偏好', type: 'text', group: 'business', sortOrder: 3, placeholder: '如：固定技师/靠窗位' },
      { key: 'channel', label: '来源渠道', type: 'select', options: ['自然到店', '美团/大众', '转介绍', '社群', '广告'], group: 'business', sortOrder: 4 },
      { key: 'remark', label: '备注', type: 'textarea', group: 'note', sortOrder: 5 },
    ],
    nicknameFormat: {
      description: '层级·称呼（关键信息）',
      useTierPrefix: true,
      tierSeparator: '·',
      useKeyInfoBrackets: true,
      nonClientPrefixes: [],
      relationSuffixes: [
        { suffix: '姐', label: '姐' },
        { suffix: '哥', label: '哥' },
      ],
      examples: [
        '储值·王姐（年卡，余 20 次）',
        '会员·李哥（健身，偏爱私教）',
        '新客·张妹（美团首单）',
      ],
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async findAll(): Promise<ContactTemplate[]> {
    const customTemplates: ContactTemplate[] = await this.loadCustomTemplates();
    const activeId = await this.readActiveId();
    return [...PRESET_TEMPLATES, ...customTemplates].map((t) => ({
      ...t,
      isActive: t.id === activeId,
    }));
  }

  async findOne(id: string): Promise<ContactTemplate> {
    const activeId = await this.readActiveId();
    const preset = PRESET_TEMPLATES.find(t => t.id === id);
    if (preset) return { ...preset, isActive: preset.id === activeId };

    const custom = await this.loadCustomTemplate(id);
    if (custom) return { ...custom, isActive: custom.id === activeId };

    throw new NotFoundException('模板不存在');
  }

  /** 当前正在使用的模板 id（按用户隔离），从未应用过返回 null */
  async getActive(): Promise<ContactTemplate | null> {
    const activeId = await this.readActiveId();
    if (!activeId) return null;
    try {
      return await this.findOne(activeId);
    } catch {
      // 指向的模板已被删除，视为未应用
      return null;
    }
  }

  async findPresets(): Promise<ContactTemplate[]> {
    const activeId = await this.readActiveId();
    return PRESET_TEMPLATES.map((t) => ({ ...t, isActive: t.id === activeId }));
  }

  /** 「当前使用模板」的存储键，按用户隔离 */
  private activeKey(): string {
    return `active_template_id:${UserContext.getUserId()}`;
  }

  private async readActiveId(): Promise<string | null> {
    try {
      const [row] = await this.db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, this.activeKey()))
        .limit(1);
      return row?.value || null;
    } catch {
      return null;
    }
  }

  private async writeActiveId(id: string): Promise<void> {
    const key = this.activeKey();
    await this.db
      .insert(systemSettings)
      .values({ key, value: id })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: id, updatedAt: new Date() },
      });
  }

  async create(dto: CreateTemplateRequest): Promise<ContactTemplate> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('模板名称不能为空');
    }
    if (!Array.isArray(dto.tiers) || dto.tiers.length === 0) {
      throw new BadRequestException('至少需要一个层级');
    }

    const id = randomUUID();
    const key = TEMPLATE_KEY_PREFIX + UserContext.getUserId() + ':' + id;
    const now = new Date();
    const nowIso = now.toISOString();

    const templateData: Omit<ContactTemplate, 'id' | 'isPreset' | 'createdAt' | 'updatedAt'> = {
      name: dto.name.trim(),
      description: dto.description ?? '',
      tiers: dto.tiers,
      identityTags: dto.identityTags ?? [],
      attributeTags: dto.attributeTags ?? [],
      fields: Array.isArray(dto.fields) ? dto.fields : [],
      nicknameFormat: dto.nicknameFormat ?? this.defaultNicknameFormat(),
    };

    await this.db.insert(systemSettings).values({
      key,
      value: JSON.stringify(templateData),
    });

    return {
      id,
      isPreset: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...templateData,
    };
  }

  async update(id: string, dto: UpdateTemplateRequest): Promise<ContactTemplate> {
    const preset = PRESET_TEMPLATES.find(t => t.id === id);
    if (preset) {
      throw new ForbiddenException('内置预设模板不可修改');
    }

    const existing = await this.loadCustomTemplate(id);
    if (!existing) {
      throw new NotFoundException('模板不存在');
    }

    const patchData: Partial<Omit<ContactTemplate, 'id' | 'isPreset' | 'createdAt' | 'updatedAt'>> = {};
    if (dto.name !== undefined) patchData.name = dto.name.trim() || existing.name;
    if (dto.description !== undefined) patchData.description = dto.description;
    if (dto.tiers !== undefined) {
      if (!Array.isArray(dto.tiers) || dto.tiers.length === 0) {
        throw new BadRequestException('至少需要一个层级');
      }
      patchData.tiers = dto.tiers;
    }
    if (dto.identityTags !== undefined) patchData.identityTags = dto.identityTags;
    if (dto.attributeTags !== undefined) patchData.attributeTags = dto.attributeTags;
    if (dto.fields !== undefined) patchData.fields = dto.fields;
    if (dto.nicknameFormat !== undefined) patchData.nicknameFormat = dto.nicknameFormat;

    if (Object.keys(patchData).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    const merged: ContactTemplate = {
      ...existing,
      ...patchData,
      updatedAt: new Date().toISOString(),
    };

    const key = TEMPLATE_KEY_PREFIX + UserContext.getUserId() + ':' + id;
    const storedValue: Omit<ContactTemplate, 'id' | 'isPreset' | 'createdAt' | 'updatedAt'> = {
      name: merged.name,
      description: merged.description,
      tiers: merged.tiers,
      identityTags: merged.identityTags,
      attributeTags: merged.attributeTags,
      fields: merged.fields ?? [],
      nicknameFormat: merged.nicknameFormat,
      derivedFrom: merged.derivedFrom ?? null,
      baseSnapshot: merged.baseSnapshot ?? null,
    };

    const result = await this.db
      .update(systemSettings)
      .set({ value: JSON.stringify(storedValue), updatedAt: new Date() })
      .where(eq(systemSettings.key, key))
      .returning({ id: systemSettings.id });

    if (result.length === 0) {
      throw new NotFoundException('模板不存在');
    }

    return merged;
  }

  async remove(id: string): Promise<void> {
    const preset = PRESET_TEMPLATES.find(t => t.id === id);
    if (preset) {
      throw new ForbiddenException('内置预设模板不可删除');
    }

    const key = TEMPLATE_KEY_PREFIX + UserContext.getUserId() + ':' + id;
    const result = await this.db
      .delete(systemSettings)
      .where(eq(systemSettings.key, key))
      .returning({ id: systemSettings.id });

    if (result.length === 0) {
      throw new NotFoundException('模板不存在');
    }

    // 删掉的正好是当前使用的模板时，清掉「当前使用」标记，避免指向一个不存在的模板
    const activeId = await this.readActiveId();
    if (activeId === id) {
      await this.db
        .delete(systemSettings)
        .where(eq(systemSettings.key, this.activeKey()));
    }
  }

  async apply(id: string, userId: string): Promise<ApplyTemplateResponse> {
    const template = await this.findOne(id);
    const ownerId = UserContext.getUserId();

    const report: TemplateApplyReport = {
      createdIdentityTags: [],
      createdAttributeTags: [],
      skippedIdentityTags: [],
      skippedAttributeTags: [],
    };

    await this.db.transaction(async (tx) => {
      // 0. 快照：先存档「应用前」的生效配置（只保留最近一次），便于追溯与找回
      const [tiersRow] = await tx
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, 'contact_tiers'))
        .limit(1);
      const [nicknameRow] = await tx
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, 'nickname_format'))
        .limit(1);
      const snapshotValue = JSON.stringify({
        appliedFrom: template.id,
        appliedFromName: template.name,
        appliedAt: new Date().toISOString(),
        previousTiersRaw: tiersRow?.value ?? null,
        previousNicknameRaw: nicknameRow?.value ?? null,
      });
      await tx
        .insert(systemSettings)
        .values({ key: APPLIED_SNAPSHOT_PREFIX + ownerId, value: snapshotValue })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: snapshotValue, updatedAt: new Date() },
        });

      // 1. 更新分层配置（contact_tiers）
      const tiersKey = 'contact_tiers';
      const tiersValue = JSON.stringify(template.tiers);
      const existingTiers = await tx
        .select({ key: systemSettings.key })
        .from(systemSettings)
        .where(eq(systemSettings.key, tiersKey));
      if (existingTiers.length > 0) {
        await tx
          .update(systemSettings)
          .set({ value: tiersValue, updatedAt: new Date() })
          .where(eq(systemSettings.key, tiersKey));
      } else {
        await tx.insert(systemSettings).values({ key: tiersKey, value: tiersValue });
      }

      // 2. 新增身份标签（category='identity'，同名跳过, 仅当前用户范围）
      if (template.identityTags.length > 0) {
        const identityNames = template.identityTags.map((t: TemplateTag) => t.name);
        const existingRows = await tx
          .select({ name: tags.name })
          .from(tags)
          .where(and(eq(tags.category, 'identity'), eq(tags.userId, ownerId), inArray(tags.name, identityNames)));
        const existingNames = new Set(existingRows.map((r: { name: string }) => r.name));
        const newTags = template.identityTags.filter((t: TemplateTag) => !existingNames.has(t.name));
        report.skippedIdentityTags = template.identityTags
          .filter((t: TemplateTag) => existingNames.has(t.name))
          .map((t: TemplateTag) => t.name);
        report.createdIdentityTags = newTags.map((t: TemplateTag) => t.name);
        if (newTags.length > 0) {
          await tx.insert(tags).values(
            newTags.map((t: TemplateTag) => ({
              userId: ownerId,
              name: t.name,
              category: 'identity',
              color: t.color ?? '#64748b',
              sortOrder: t.sortOrder,
              createdBy: userId,
              updatedBy: userId,
            })),
          );
        }
      }

      // 3. 新增属性标签（category='attribute'，同名跳过, 仅当前用户范围）
      if (template.attributeTags.length > 0) {
        const attributeNames = template.attributeTags.map((t: TemplateTag) => t.name);
        const existingRows = await tx
          .select({ name: tags.name })
          .from(tags)
          .where(and(eq(tags.category, 'attribute'), eq(tags.userId, ownerId), inArray(tags.name, attributeNames)));
        const existingNames = new Set(existingRows.map((r: { name: string }) => r.name));
        const newTags = template.attributeTags.filter((t: TemplateTag) => !existingNames.has(t.name));
        report.skippedAttributeTags = template.attributeTags
          .filter((t: TemplateTag) => existingNames.has(t.name))
          .map((t: TemplateTag) => t.name);
        report.createdAttributeTags = newTags.map((t: TemplateTag) => t.name);
        if (newTags.length > 0) {
          await tx.insert(tags).values(
            newTags.map((t: TemplateTag) => ({
              userId: ownerId,
              name: t.name,
              category: 'attribute',
              color: t.color ?? '#64748b',
              sortOrder: t.sortOrder,
              createdBy: userId,
              updatedBy: userId,
            })),
          );
        }
      }

      // 4. 更新昵称格式配置（nickname_format）
      const nicknameKey = 'nickname_format';
      const nicknameValue = JSON.stringify(template.nicknameFormat);
      const existingNickname = await tx
        .select({ key: systemSettings.key })
        .from(systemSettings)
        .where(eq(systemSettings.key, nicknameKey));
      if (existingNickname.length > 0) {
        await tx
          .update(systemSettings)
          .set({ value: nicknameValue, updatedAt: new Date() })
          .where(eq(systemSettings.key, nicknameKey));
      } else {
        await tx.insert(systemSettings).values({ key: nicknameKey, value: nicknameValue });
      }

      // 5. 记录「当前正在使用的模板」，供 Web 端做视觉区分、App 端判断默认模板。
      //    没有这一步，apply 之后无法回答"我现在用的是哪个模板"。
      const activeKey = this.activeKey();
      await tx
        .insert(systemSettings)
        .values({ key: activeKey, value: template.id })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: template.id, updatedAt: new Date() },
        });
    });

    return { ...template, isActive: true, applyReport: report };
  }

  /**
   * 另存为新方案：把任意模板（预设或自定义）深拷贝为当前用户的一个新自定义方案。
   * 同时写入 derivedFrom（来源 id）与 baseSnapshot（来源内容快照），
   * 之后可随时「重置」回这份初始内容，不怕改崩。
   */
  async duplicate(id: string, dto: DuplicateTemplateRequest = {}): Promise<ContactTemplate> {
    const source = await this.findOne(id);

    const newId = randomUUID();
    const key = TEMPLATE_KEY_PREFIX + UserContext.getUserId() + ':' + newId;
    const nowIso = new Date().toISOString();

    const templateData: Omit<ContactTemplate, 'id' | 'isPreset' | 'createdAt' | 'updatedAt'> = {
      name: dto.name?.trim() || `${source.name} 副本`,
      description: source.description,
      tiers: cloneJson(source.tiers),
      identityTags: cloneJson(source.identityTags),
      attributeTags: cloneJson(source.attributeTags),
      fields: cloneJson(source.fields ?? []),
      nicknameFormat: cloneJson(source.nicknameFormat),
      derivedFrom: source.id,
      baseSnapshot: {
        name: source.name,
        description: source.description,
        tiers: cloneJson(source.tiers),
        identityTags: cloneJson(source.identityTags),
        attributeTags: cloneJson(source.attributeTags),
        fields: cloneJson(source.fields ?? []),
        nicknameFormat: cloneJson(source.nicknameFormat),
      },
    };

    await this.db.insert(systemSettings).values({ key, value: JSON.stringify(templateData) });

    return { id: newId, isPreset: false, createdAt: nowIso, updatedAt: nowIso, ...templateData };
  }

  /**
   * 重置自定义方案：把内容恢复为「另存那一刻」的初始快照（baseSnapshot）。
   * 若该方案当前正在使用，同步覆盖 contact_tiers / nickname_format，保持所见即所得。
   */
  async reset(id: string): Promise<ContactTemplate> {
    if (PRESET_TEMPLATES.some(t => t.id === id)) {
      throw new ForbiddenException('内置预设模板无需重置');
    }

    const existing = await this.loadCustomTemplate(id);
    if (!existing) {
      throw new NotFoundException('模板不存在');
    }
    if (!existing.baseSnapshot) {
      throw new BadRequestException('该方案没有可恢复的初始版本（仅「另存为新方案」创建的方案支持重置）');
    }

    const base = existing.baseSnapshot;
    // 只恢复内容；方案名保留（名字是用户另存时起的身份，重置后不应被源模板名覆盖）
    const restored: ContactTemplate = {
      ...existing,
      description: base.description,
      tiers: base.tiers,
      identityTags: base.identityTags,
      attributeTags: base.attributeTags,
      fields: base.fields ?? [],
      nicknameFormat: base.nicknameFormat,
      updatedAt: new Date().toISOString(),
    };

    const key = TEMPLATE_KEY_PREFIX + UserContext.getUserId() + ':' + id;
    const storedValue: Omit<ContactTemplate, 'id' | 'isPreset' | 'createdAt' | 'updatedAt'> = {
      name: restored.name,
      description: restored.description,
      tiers: restored.tiers,
      identityTags: restored.identityTags,
      attributeTags: restored.attributeTags,
      fields: restored.fields ?? [],
      nicknameFormat: restored.nicknameFormat,
      derivedFrom: existing.derivedFrom ?? null,
      baseSnapshot: existing.baseSnapshot,
    };
    const result = await this.db
      .update(systemSettings)
      .set({ value: JSON.stringify(storedValue), updatedAt: new Date() })
      .where(eq(systemSettings.key, key))
      .returning({ id: systemSettings.id });
    if (result.length === 0) {
      throw new NotFoundException('模板不存在');
    }

    // 正在使用的方案被重置时，同步覆盖生效配置，避免「看到的是重置前、生效的是重置前」错位
    const activeId = await this.readActiveId();
    if (activeId === id) {
      await this.writeEffectiveConfig(restored.tiers, restored.nicknameFormat);
    }

    return restored;
  }

  /**
   * 恢复出厂（仅当前用户范围）：
   * 1. 删除全部自定义方案（template_{userId}:*）
   * 2. 清除「使用中」与「应用前快照」标记
   * 3. 分层与昵称配置重置为系统出厂值（S/A/B/C/D/V）
   * 注意：不动 tags / contact_tags——用户已建立的联系人与标签数据不受影响。
   */
  async resetAll(dto: ResetAllTemplatesRequest): Promise<{ removedTemplates: number }> {
    if (dto?.confirm !== 'RESET') {
      throw new BadRequestException('缺少确认参数：请求体需为 { "confirm": "RESET" }');
    }

    const ownerId = UserContext.getUserId();
    const userPrefix = TEMPLATE_KEY_PREFIX + ownerId + ':';
    const deleted = await this.db
      .delete(systemSettings)
      .where(like(systemSettings.key, userPrefix + '%'))
      .returning({ id: systemSettings.id });

    await this.db
      .delete(systemSettings)
      .where(inArray(systemSettings.key, [this.activeKey(), APPLIED_SNAPSHOT_PREFIX + ownerId]));

    await this.writeEffectiveConfig(FACTORY_TIERS, this.defaultNicknameFormat());

    this.logger.warn(`reset-all by user ${ownerId}: removed ${deleted.length} custom template(s)`);
    return { removedTemplates: deleted.length };
  }

  /** 把分层与昵称配置写入生效 key（contact_tiers / nickname_format），供重置场景使用 */
  private async writeEffectiveConfig(tiers: TemplateTier[], nicknameFormat: NicknameFormatConfig): Promise<void> {
    const entries = [
      { key: 'contact_tiers', value: JSON.stringify(tiers) },
      { key: 'nickname_format', value: JSON.stringify(nicknameFormat) },
    ];
    for (const e of entries) {
      await this.db
        .insert(systemSettings)
        .values({ key: e.key, value: e.value })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: e.value, updatedAt: new Date() },
        });
    }
  }

  private async loadCustomTemplates(): Promise<ContactTemplate[]> {
    const userPrefix = TEMPLATE_KEY_PREFIX + UserContext.getUserId() + ':';
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(like(systemSettings.key, userPrefix + '%'))
      .orderBy(asc(systemSettings.key));

    const templates: ContactTemplate[] = [];
    for (const row of rows) {
      const id = row.key.slice(userPrefix.length);
      if (!id) continue;
      try {
        const parsed = JSON.parse(row.value ?? '{}');
        templates.push({
          id,
          name: parsed.name ?? '未命名模板',
          description: parsed.description ?? '',
          isPreset: false,
          tiers: Array.isArray(parsed.tiers) ? parsed.tiers : [],
          identityTags: Array.isArray(parsed.identityTags) ? parsed.identityTags : [],
          attributeTags: Array.isArray(parsed.attributeTags) ? parsed.attributeTags : [],
          fields: Array.isArray(parsed.fields) ? parsed.fields : [],
          nicknameFormat: parsed.nicknameFormat ?? this.defaultNicknameFormat(),
          derivedFrom: parsed.derivedFrom ?? null,
          baseSnapshot: parsed.baseSnapshot ?? null,
          createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
          updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        });
      } catch (e) {
        this.logger.warn(`Failed to parse template ${row.key}, deleting corrupted record`, e as Error);
        await this.db.delete(systemSettings).where(eq(systemSettings.key, row.key));
      }
    }
    return templates;
  }

  private async loadCustomTemplate(id: string): Promise<ContactTemplate | null> {
    const key = TEMPLATE_KEY_PREFIX + UserContext.getUserId() + ':' + id;
    const [row] = await this.db.select().from(systemSettings).where(eq(systemSettings.key, key));
    if (!row) return null;

    try {
      const parsed = JSON.parse(row.value ?? '{}');
      return {
        id,
        name: parsed.name ?? '未命名模板',
        description: parsed.description ?? '',
        isPreset: false,
        tiers: Array.isArray(parsed.tiers) ? parsed.tiers : [],
        identityTags: Array.isArray(parsed.identityTags) ? parsed.identityTags : [],
        attributeTags: Array.isArray(parsed.attributeTags) ? parsed.attributeTags : [],
        fields: Array.isArray(parsed.fields) ? parsed.fields : [],
        nicknameFormat: parsed.nicknameFormat ?? this.defaultNicknameFormat(),
        derivedFrom: parsed.derivedFrom ?? null,
        baseSnapshot: parsed.baseSnapshot ?? null,
        createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
        updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      };
    } catch (e) {
      this.logger.warn(`Failed to parse template ${key}`, e as Error);
      return null;
    }
  }

  private defaultNicknameFormat(): NicknameFormatConfig {
    return {
      description: '层级·称呼（关键信息）',
      useTierPrefix: true,
      tierSeparator: '·',
      useKeyInfoBrackets: true,
      nonClientPrefixes: [],
      relationSuffixes: [],
      examples: ['A·张哥（备注）'],
    };
  }
}
