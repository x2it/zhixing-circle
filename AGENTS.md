# 知行朋友圈 设计规范

## 应用概述
基于"ABC客户分层 + 弱关系维护"理论的个人人脉管理工具。极简克制、卡片式、一眼看懂。面向房产经纪人等需要精细化人脉运营的人群，支持手机端随时操作。

## 技术架构
- 前端：React 19 + TypeScript + Tailwind CSS + shadcn/ui
- 后端：NestJS + Drizzle ORM + PostgreSQL
- 认证：单用户密码登录（前端路由守卫 + 后端 API Key Guard 可选鉴权）
- 主题：双主题 — 浅色（白底深字）/ 暖白（暖白底），无深色模式

## 设计规范

### 设计理念
- 极简克制：大量留白，颜色克制，扁平化无渐变
- 低饱和强调色：深蓝灰 hsl(215 25% 27%) 作为主色，不用花哨颜色
- 扁平无阴影：卡片用细边框，极浅阴影或无阴影
- 小圆角：统一 6px 及以下（`--radius: 0.375rem`）
- 线性图标：strokeWidth 1.5，线条粗细统一

### 色彩系统
- 主色：`hsl(215 25% 27%)`（深蓝灰，克制的深色调）
- 文字主色：`hsl(220 13% 18%)` 深灰
- 文字辅助：`hsl(215 10% 47%)` 中灰
- 背景：白色 `hsl(0 0% 100%)`（浅色主题）/ 暖白 `hsl(40 27% 98%)`（暖白主题）
- 卡片：白色 / 暖白
- 边框：`hsl(220 13% 91%)` 极浅灰
- 层级色（简单字母圆形标签，无复杂图标）：
  - S/A/B/C/D/V 用同色系不同深浅的灰或一个低饱和色区分

### 间距规范
- 页面内边距：p-5（桌面）/ p-4（手机）
- 卡片内边距：p-4（16px）/ 手机端 p-3
- 元素间距：gap-3（12px）为基础间距
- 卡片间距：gap-4（16px）/ gap-5（20px）大区块

### 排版
- 页面标题：text-xl font-medium（手机端 text-lg）
- 卡片标题：text-base font-medium
- 正文：text-sm text-foreground/80
- 辅助文字：text-xs text-muted-foreground
- 数据数字：text-xl font-semibold（手机端 text-lg）

### 卡片风格
- 圆角：rounded-md（6px）
- 阴影：shadow-none 或极浅 shadow-sm
- 边框：border border-border（细边框）
- 过渡：transition-colors duration-150

### 移动端适配
- 所有页面响应式，手机端单列流式
- 底部导航固定操作热区
- 按钮/输入框最小点击高度 40px
- 字体不小于 12px，图标不小于 20px 点击区域

### 数据库表
- contacts：联系人主表
- tags：标签表
- contact_tags：联系人-标签关联表（多对多）
- followups：跟进记录表
- system_settings：系统配置表（存密码等）
- api_keys：API 密钥表

### 模块清单
- server/modules/contacts/ - 联系人模块
- server/modules/tags/ - 标签模块
- server/modules/followups/ - 跟进记录模块
- server/modules/auth/ - 认证模块
- server/modules/api-keys/ - API 密钥管理模块
- server/modules/data/ - 数据导入导出模块
- server/modules/dashboard/ - 仪表盘统计模块
- server/common/guards/api-key.guard.ts - API Key 可选鉴权 Guard
