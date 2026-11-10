import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { clearSession, getUser } from '../../auth/store';
import UploadPage from './UploadPage';
import ProgressPage from './ProgressPage';

/** 借款侧工作台：上传 → 进度，两步闭环。 */
export default function BorrowerApp() {
  const navigate = useNavigate();
  const user = getUser();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand small">
          <i>风</i>
          <span>银行流水材料提交</span>
        </div>
        <nav className="topnav">
          <Link to="/app/upload">上传流水</Link>
        </nav>
        <div className="topbar-right">
          <span>{user?.display_name || user?.username}</span>
          <button
            className="btn btn-ghost"
            onClick={() => {
              clearSession();
              navigate('/login');
            }}
          >
            退出
          </button>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route index element={<Navigate to="upload" replace />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="tasks/:id" element={<ProgressPage />} />
          <Route path="*" element={<Navigate to="upload" replace />} />
        </Routes>
      </main>
    </div>
  );
}
