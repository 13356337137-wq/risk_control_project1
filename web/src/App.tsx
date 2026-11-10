import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireRole } from './auth/guards';
import LandingPage from './pages/public/LandingPage';
import LoginPage from './pages/public/LoginPage';
import RegisterPage from './pages/public/RegisterPage';
import ComingSoon from './pages/ComingSoon';

// 按角色分包：借款侧不该下载银行侧的代码
const BorrowerApp = lazy(() => import('./pages/borrower/BorrowerApp'));
const BankerApp = lazy(() => import('./pages/banker/BankerApp'));

export default function App() {
  return (
    <Suspense fallback={<div className="boot">加载中…</div>}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route
          path="/app/*"
          element={
            <RequireRole role="borrower">
              <BorrowerApp />
            </RequireRole>
          }
        />
        <Route
          path="/bank/*"
          element={
            <RequireRole role="banker">
              <BankerApp />
            </RequireRole>
          }
        />

        {/* 旧地址兼容：书签不能失效 */}
        <Route path="/portal" element={<Navigate to="/" replace />} />
        <Route path="*" element={<ComingSoon title="页面不存在" detail="请从首页重新进入。" />} />
      </Routes>
    </Suspense>
  );
}
