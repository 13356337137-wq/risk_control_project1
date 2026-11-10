import { useNavigate } from 'react-router-dom';
import { clearSession, getUser } from '../../auth/store';

/**
 * 银行侧工作台。
 *
 * 骨架阶段只放导航与占位；任务列表、报告、模板、标注等页面按 M6 方案逐页迁入。
 * 旧页面仍由后端挂在 /bank-old/ 提供。
 */
export default function BankerApp() {
  const navigate = useNavigate();
  const user = getUser();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand small">
          <i>风</i>
          <span>银行工作台</span>
        </div>
        <div className="topbar-right">
          <span>
            {user?.display_name || user?.username}
            {user?.is_admin ? ' · 管理员' : ''}
          </span>
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
            银行侧的受理、报告、模板与标注页面正在逐页迁入。迁移期间请使用旧入口：
            <a className="inline-link" href="/bank-old/">
              {' '}旧版银行侧
            </a>
            。
          </p>
          <p className="sub">导航骨架已就绪，页面按 M6 方案逐页替换，旧地址会做重定向。</p>
        </div>
      </main>
    </div>
  );
}
