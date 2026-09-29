import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import { AppContainer } from '@lark-apaas/client-toolkit/components/AppContainer';
import { ErrorRender } from '@lark-apaas/client-toolkit/components/ErrorRender';

import RoutesComponent from './app.tsx';
import './index.css';
import { createPortal } from 'react-dom';
import { Toaster } from '@client/src/components/ui/sonner';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

// 平台构建会把 <title> 换成 {{appName}} 占位符，且 toolkit 的 useAppInfo
// 会在 mount 后把 title 覆盖为平台应用名。这里先纠正一次，
// 再用 MutationObserver 拦截平台对 title 的覆盖（仅当被改回平台名时纠正），
// Layout 按页面设置的「页面名 · 知行朋友圈」不受影响。
if (document.title !== '知行朋友圈') {
  document.title = '知行朋友圈';
}
try {
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => {
      if (document.title === '妙搭应用') {
        document.title = '知行朋友圈';
      }
    }).observe(titleEl, { subtree: true, childList: true, characterData: true });
  }
} catch {
  /* 老浏览器不支持 observer 时保持一次性纠正 */
}

const MainApp = () => {
  return (
    <BrowserRouter basename={CLIENT_BASE_PATH}>
      <AppContainer defaultTheme="light">
        <ErrorBoundary
          fallbackRender={({ error, resetErrorBoundary }) => (
            <ErrorRender
              error={error as Error}
              resetErrorBoundary={resetErrorBoundary}
            />
          )}
        >
          <RoutesComponent />
          {createPortal(<Toaster />, document.body)}
        </ErrorBoundary>
      </AppContainer>
    </BrowserRouter>
  );
};

createRoot(document.getElementById('root')!).render(<MainApp />);
