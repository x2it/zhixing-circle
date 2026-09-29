import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'warm';

interface ThemeContextValue {
  mode: ThemeMode;
  toggleMode: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'zx_theme_mode';

/** 主题循环顺序：明亮 → 夜间 → 暖阳 */
const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'warm'];

function normalizeMode(saved: string | null): ThemeMode {
  return saved === 'dark' || saved === 'warm' ? saved : 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light';
    // 首次访问且系统偏好深色时，默认进入夜间模式
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeMode(saved);
    const prefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = mode;
    // 兼容依赖 .dark 类名的组件（Tailwind dark: 变体）
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode === 'dark' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev: ThemeMode) => {
      const idx = THEME_CYCLE.indexOf(prev);
      return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, toggleMode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
