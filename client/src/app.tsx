import React from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { setupAuthInterceptor } from './api/setup';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './pages/NotFound/NotFound';
import LoginPage from './pages/LoginPage/LoginPage';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import ContactsPage from './pages/ContactsPage/ContactsPage';
import TagsPage from './pages/TagsPage/TagsPage';
import MomentsPage from './pages/MomentsPage/MomentsPage';
import DataPage from './pages/DataPage/DataPage';
import ApiDocsPage from './pages/ApiDocsPage/ApiDocsPage';
import TemplatesPage from './pages/TemplatesPage/TemplatesPage';
import CommunicationsPage from './pages/CommunicationsPage/CommunicationsPage';

// 全局 401 拦截：会话过期统一跳登录页
setupAuthInterceptor();

const RoutesComponent = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
      <Routes>
        {/* Login - no layout, public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected routes with layout */}
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="moments" element={<MomentsPage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="api-docs" element={<ApiDocsPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="communications" element={<CommunicationsPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default RoutesComponent;
