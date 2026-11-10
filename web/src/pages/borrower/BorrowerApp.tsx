
import { getUser, clearSession } from '../../auth/store';
import { useNavigate } from 'react-router-dom';

/**
 * 借款侧工作台。
 *
 * 这一版只是骨架：上传与进度页在 M6 第 2 步迁进来。
 * 旧页面仍由后端挂在 /app-old/ 提供，确保迁移期间业务不中断。
 */
export default function BorrowerApp() {
  const navigate = useNavigate();
  const user = getUser();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand small">
          <i>风</i>
          <span>借款人工作台</span>
        </div>
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
        <div className="card">
          <h1>迁移进行中</h1>
          <p className="sub">
            借款侧的上传与进度页正在迁入新的单页应用。迁移期间请使用旧入口：
            <a className="inline-link" href="/app-old/">
              {' '}旧版借款侧
            </a>
            。
          </p>
          <p className="sub">新入口会在这里出现，地址不变（/app/upload、/app/progress）。</p>
        </div>
      </main>
    </div>
  );
}
