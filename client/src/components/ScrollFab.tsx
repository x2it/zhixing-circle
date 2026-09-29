import React, { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScrollFabProps {
  /** 是否启用显示 */
  enabled?: boolean;
  /** 列表至少多长才显示（默认 20 条） */
  minItems?: number;
}

/**
 * 长列表快速滚动：到顶 / 到底。
 * 页面滚动容器是 window（Layout 的 main 无 overflow），直接操作 window 即可。
 */
const ScrollFab: React.FC<ScrollFabProps> = ({ enabled = true, minItems = 20 }) => {
  const [visible, setVisible] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }

    let raf = 0;
    const measure = () => {
      raf = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const long = max > 400;
      setVisible(long);
      setAtTop(y < 24);
      setAtBottom(max <= 0 ? true : y >= max - 24);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);

  if (!enabled || !visible) return null;

  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const toBottom = () =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });

  const btnClass = cn(
    'h-12 w-12 md:h-11 md:w-11 rounded-full flex items-center justify-center',
    'bg-background/95 backdrop-blur border border-border shadow-sm',
    'touch-manipulation active:scale-95 transition-transform duration-150',
    'disabled:opacity-30 disabled:pointer-events-none',
  );

  return (
    <div
      className={cn(
        'fixed right-3 md:right-5 z-30 flex flex-col gap-2',
        // 移动端抬高避开底部 tab（h-14）+ 安全区；桌面端贴右下
        'bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-5',
      )}
      aria-label="快速滚动"
    >
      <button
        type="button"
        className={btnClass}
        onClick={toTop}
        disabled={atTop}
        aria-label="回到顶部"
        title="回到顶部"
      >
        <ArrowUp className="w-5 h-5" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className={btnClass}
        onClick={toBottom}
        disabled={atBottom}
        aria-label="跳到底部"
        title="跳到底部"
      >
        <ArrowDown className="w-5 h-5" strokeWidth={1.5} />
      </button>
    </div>
  );
};

export default ScrollFab;
