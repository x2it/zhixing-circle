import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Users,
  LayoutDashboard,
  Tags,
  Share2,
  Database,
  Code2,
  LogOut,
  MessageCircle,
  MessagesSquare,
  Sun,
  Moon,
  Sparkles,
  Palette,
  MoreHorizontal,
  X,
  KeyRound,
  Menu,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import ChangePasswordDialog from '@client/src/components/ChangePasswordDialog';
import { useAuth } from '@client/src/contexts/AuthContext';
import { useTheme } from '@client/src/contexts/ThemeContext';
import { Popover, PopoverTrigger, PopoverContent } from '@client/src/components/ui/popover';
import { Check } from 'lucide-react';
import type { ThemeMode } from '@client/src/contexts/ThemeContext';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: React.FC<{ className?: string; strokeWidth?: number }>;
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { to: '/contacts', label: '联系人', icon: Users },
  { to: '/communications', label: '沟通记录', icon: MessagesSquare },
  { to: '/tags', label: '标签', icon: Tags },
  { to: '/moments', label: '朋友圈', icon: Share2 },
  { to: '/data', label: '数据', icon: Database },
  { to: '/templates', label: '模板', icon: Palette },
  { to: '/api-docs', label: 'API', icon: Code2 },
];

const bottomNavItems: NavItem[] = [
  { to: '/dashboard', label: '首页', icon: LayoutDashboard },
  { to: '/contacts', label: '联系人', icon: Users },
  { to: '/communications', label: '沟通', icon: MessagesSquare },
  { to: '/moments', label: '朋友圈', icon: MessageCircle },
  { to: '/tags', label: '标签', icon: Tags },
];

const pageTitleMap: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/contacts': '联系人',
  '/communications': '沟通记录',
  '/tags': '标签管理',
  '/moments': '朋友圈分组',
  '/data': '数据管理',
  '/templates': '模板方案',
  '/api-docs': 'API 接入',
};

const themeMeta: Record<string, { icon: React.FC<{ className?: string; strokeWidth?: number }>; label: string }> = {
  light: { icon: Sun, label: '明亮' },
  dark: { icon: Moon, label: '夜间' },
  warm: { icon: Sparkles, label: '暖阳' },
};

const THEME_SWATCHES: Record<string, string[]> = {
  light: ['#ffffff', '#f1f5f9', '#334155'],
  dark: ['#0f172a', '#1e293b', '#94a3b8'],
  warm: ['#fdf3e3', '#f3e3c8', '#92400e'],
};

const THEME_TIPS: Record<string, string> = {
  light: '白天办公，清爽高对比',
  dark: '暗光环境，护眼低刺激',
  warm: '暖色调，温和不刺眼',
};

/** 主题切换：点开调色盘一键直达目标主题（替代旧的三态循环，少点几次） */
const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const meta = themeMeta[mode] ?? themeMeta.light;
  const Icon = meta.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
            compact ? 'px-2 py-1.5 text-xs' : 'px-2.5 py-1.5 text-xs',
          )}
          title="选择主题"
          aria-label="选择主题"
        >
          <Icon className="w-4 h-4" strokeWidth={1.5} />
          {!compact && <span className="hidden sm:inline">{meta.label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <p className="text-xs font-medium text-muted-foreground px-2 pt-1 pb-2">主题</p>
        <div className="space-y-0.5">
          {(Object.keys(themeMeta) as Array<keyof typeof themeMeta>).map((key) => {
            const m = themeMeta[key];
            const OptIcon = m.icon;
            const active = key === mode;
            return (
              <button
                key={key}
                type="button"
                className={cn(
                  'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-sm transition-colors',
                  active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent text-foreground',
                )}
                onClick={() => {
                  setMode(key as ThemeMode);
                  setOpen(false);
                }}
              >
                <OptIcon className="w-4 h-4" strokeWidth={1.5} />
                <span className="flex-1 text-left leading-tight">
                  {m.label}
                  <span className="block text-[10px] text-muted-foreground font-normal">
                    {THEME_TIPS[key]}
                  </span>
                </span>
                <span className="flex gap-0.5 mr-1">
                  {(THEME_SWATCHES[key] ?? []).map((c) => (
                    <span
                      key={c}
                      className="w-3 h-3 rounded-full border border-black/10"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                {active && <Check className="w-4 h-4" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** 面包屑：多终端自适应（移动端只显示当前页，桌面显示完整路径） */
const Breadcrumb: React.FC<{ current: string; className?: string }> = ({ current, className }) => (
  <nav aria-label="面包屑" className={cn('flex items-center gap-1 text-xs text-muted-foreground min-w-0', className)}>
    <NavLink to="/dashboard" className="hover:text-foreground transition-colors shrink-0">
      首页
    </NavLink>
    <ChevronRight className="w-3 h-3 shrink-0 opacity-60" strokeWidth={1.5} />
    <span className="text-foreground font-medium truncate">{current}</span>
  </nav>
);

const Layout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const currentTitle = pageTitleMap[location.pathname] ?? '知行朋友圈';

  useEffect(() => {
    // 按页面动态 title；首页不带前缀
    document.title =
      location.pathname === '/dashboard' ? '知行朋友圈' : `${currentTitle} · 知行朋友圈`;
  }, [location.pathname, currentTitle]);

  // 路由变化时自动收起所有浮层，避免"点了没反应/遮住内容"
  useEffect(() => {
    setDrawerOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  // 浮层打开时锁定页面滚动
  useEffect(() => {
    const locked = drawerOpen || moreOpen;
    document.body.style.overflow = locked ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen, moreOpen]);

  const handleLogout = () => {
    setMoreOpen(false);
    setDrawerOpen(false);
    logout();
    toast.success('已退出登录');
    navigate('/login', { replace: true });
  };

  const moreItems: Array<{ to: string; label: string; icon: React.FC<{ className?: string; strokeWidth?: number }> }> = [
    { to: '/data', label: '数据管理', icon: Database },
    { to: '/templates', label: '模板方案', icon: Palette },
    { to: '/api-docs', label: 'API 接入', icon: Code2 },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar — 桌面端（Win11 亚克力材质） */}
      <aside
        className={`hidden md:flex flex-col bg-sidebar win-acrylic border-r border-sidebar-border transition-all duration-200 sticky top-0 self-start h-screen z-30 ${
          collapsed ? 'w-14' : 'w-[190px]'
        }`}
      >
        <div className="flex items-center h-14 px-3 border-b border-sidebar-border justify-between">
          <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-primary-foreground" strokeWidth={1.5} />
            </div>
            {!collapsed && (
              <span className="text-sm font-medium text-foreground whitespace-nowrap truncate">
                知行朋友圈
              </span>
            )}
          </div>
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="收起侧边栏"
            >
              <PanelLeftClose className="w-4 h-4" strokeWidth={1.5} />
            </button>
          )}
        </div>

        <nav className="flex-1 py-3 px-1.5 space-y-0.5">
          {navItems.map((item: NavItem) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `win-nav-item flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                    isActive
                      ? 'win-nav-active bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  } ${collapsed ? 'justify-center' : ''}`
                }
                title={collapsed ? item.label : undefined}
              >
                <Icon className="w-4.5 h-4.5 flex-shrink-0" strokeWidth={1.5} />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="w-full flex items-center justify-center px-2.5 py-2 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title="展开侧边栏"
            >
              <PanelLeftOpen className="w-4.5 h-4.5" strokeWidth={1.5} />
            </button>
          )}
        </nav>

        <div className="px-1.5 pb-3 pt-2 border-t border-sidebar-border space-y-0.5">
          {!collapsed && user && (
            <div className="px-2.5 py-1.5 text-xs text-sidebar-foreground/50 truncate" title={user.username}>
              {user.displayName || user.username}
            </div>
          )}
          <button
            onClick={() => setPwdOpen(true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
            title={collapsed ? '修改密码' : undefined}
          >
            <KeyRound className="w-4.5 h-4.5 flex-shrink-0" strokeWidth={1.5} />
            {!collapsed && <span>修改密码</span>}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-sidebar-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
            title={collapsed ? '退出登录' : undefined}
          >
            <LogOut className="w-4.5 h-4.5 flex-shrink-0" strokeWidth={1.5} />
            {!collapsed && <span>退出登录</span>}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — 桌面端（含面包屑，亚克力） */}
        <header className="hidden md:flex h-14 bg-background/70 win-acrylic border-b border-border px-5 items-center justify-between gap-4 sticky top-0 z-30">
          <Breadcrumb current={currentTitle} />
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
          </div>
        </header>

        {/* Header — 移动端：三明治菜单 + 品牌 + 主题切换，下方面包屑（亚克力） */}
        <header className="md:hidden sticky top-0 z-30 bg-background/85 win-acrylic border-b border-border">
          <div className="flex h-12 px-3 items-center justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0">
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-2 -ml-1 rounded-md text-foreground hover:bg-accent transition-colors"
                aria-label="打开菜单"
              >
                <Menu className="w-5 h-5" strokeWidth={1.5} />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
                  <Users className="w-3.5 h-3.5 text-primary-foreground" strokeWidth={1.5} />
                </div>
                <span className="text-sm font-medium text-foreground truncate">知行朋友圈</span>
              </div>
            </div>
            <ThemeToggle compact />
          </div>
          <div className="px-4 pb-2">
            <Breadcrumb current={currentTitle} />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 md:p-5 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-5 min-w-0">
          <Outlet />
        </main>

        {/* Bottom Navigation — 移动端（亚克力） */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background/85 win-acrylic border-t border-border z-40 pb-[env(safe-area-inset-bottom)]">
          <div className="flex justify-around items-stretch h-14">
            {bottomNavItems.map((item: NavItem) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center flex-1 gap-0.5 ${
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    }`
                  }
                >
                  <Icon className="w-5 h-5" strokeWidth={1.5} />
                  <span className="text-[10px]">{item.label}</span>
                </NavLink>
              );
            })}
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex flex-col items-center justify-center flex-1 gap-0.5 text-muted-foreground active:bg-accent transition-colors"
              aria-label="更多功能"
            >
              <MoreHorizontal className="w-5 h-5" strokeWidth={1.5} />
              <span className="text-[10px]">更多</span>
            </button>
          </div>
        </nav>
      </div>

      {/* 三明治抽屉 — 移动端全功能导航 */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 bottom-0 w-[78%] max-w-[300px] bg-sidebar border-r border-sidebar-border flex flex-col shadow-xl">
            <div className="flex items-center justify-between h-14 px-4 border-b border-sidebar-border">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-primary-foreground" strokeWidth={1.5} />
                </div>
                <span className="text-sm font-medium text-foreground truncate">知行朋友圈</span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                aria-label="关闭菜单"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
              {navItems.map((item: NavItem) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setDrawerOpen(false)}
                    className={({ isActive }) =>
                      `win-nav-item flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                        isActive
                          ? 'win-nav-active bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                      }`
                    }
                  >
                    <Icon className="w-4.5 h-4.5 shrink-0" strokeWidth={1.5} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="px-2 pb-4 pt-2 border-t border-sidebar-border space-y-1">
              {user && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground truncate">
                  {user.displayName || user.username}
                </div>
              )}
              <button
                onClick={() => {
                  setDrawerOpen(false);
                  setPwdOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
              >
                <KeyRound className="w-4.5 h-4.5 shrink-0" strokeWidth={1.5} />
                <span>修改密码</span>
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-4.5 h-4.5 shrink-0" strokeWidth={1.5} />
                <span>退出登录</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 更多功能 — 移动端底部抽屉 */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 bg-background border-t border-border rounded-t-2xl shadow-xl pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-sm font-medium text-foreground">更多功能</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                aria-label="关闭"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="px-4 pb-2">
              <div className="grid grid-cols-3 gap-3">
                {moreItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-muted hover:bg-accent transition-colors"
                    >
                      <Icon className="w-5 h-5 text-foreground" strokeWidth={1.5} />
                      <span className="text-[11px] text-foreground/80">{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border space-y-1">
              {user && (
                <div className="text-center text-xs text-muted-foreground pb-1">
                  {user.displayName || user.username}
                </div>
              )}
              <button
                onClick={() => {
                  setMoreOpen(false);
                  setPwdOpen(true);
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-foreground hover:bg-accent transition-colors"
              >
                <KeyRound className="w-4 h-4" strokeWidth={1.5} />
                修改密码
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-4 h-4" strokeWidth={1.5} />
                退出登录
              </button>
            </div>
          </div>
        </div>
      )}

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </div>
  );
};

export default Layout;
