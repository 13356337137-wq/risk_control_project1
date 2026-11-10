import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { clearSession, getUser } from '../../auth/store';
import TaskListPage from './TaskListPage';
import ReportPage from './ReportPage';
import AuditPage from './AuditPage';
import UsersPage from './UsersPage';
import TemplatesPage from './TemplatesPage';
import TemplateDetailPage from './TemplateDetailPage';
import TemplateLayoutPage from './TemplateLayoutPage';
import MetricDefsPage from './MetricDefsPage';
import VerificationDefsPage from './VerificationDefsPage';
import ComingSoon from '../ComingSoon';

/**
 * 银行侧工作台。
 *
 * 侧栏按「受理与报告 / 模板 / 参数 / 系统」分组，和旧版的信息架构保持一致——
 * 客户经理的心智模型是按任务走的，不是按功能表走的。
 *
 * 模板、标注、阈值、实体合并、OCR 路由与看板还没迁完，路由指向占位页并给出旧入口。
 */
export default function BankerApp() {
  const navigate = useNavigate();
  const user = getUser();
  const isAdmin = Boolean(user?.is_admin);

  return (
    <div className="shell with-sider">
      <header className="topbar">
        <div className="brand small">
          <i>风</i>
          <span>银行工作台</span>
        </div>
        <div className="topbar-right">
          <span>
            {user?.display_name || user?.username}
            {isAdmin ? ' · 管理员' : ''}
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

      <div className="body">
        <nav className="sider">
          <div className="sider-group">
            <span className="sider-title">受理与报告</span>
            <NavLink to="/bank/tasks">任务与报告</NavLink>
          </div>
          <div className="sider-group">
            <span className="sider-title">模板</span>
            <NavLink to="/bank/templates" end>模板库</NavLink>
            <NavLink to="/bank/annotate">标注</NavLink>
          </div>
          <div className="sider-group">
            <span className="sider-title">参数</span>
            <NavLink to="/bank/metrics">指标口径</NavLink>
            <NavLink to="/bank/verifications">校验口径</NavLink>
            <NavLink to="/bank/thresholds">风控参数</NavLink>
            <NavLink to="/bank/entities">客户与账户</NavLink>
            <NavLink to="/bank/ocr">OCR 路由</NavLink>
          </div>
          {isAdmin ? (
            <div className="sider-group">
              <span className="sider-title">系统</span>
              <NavLink to="/bank/audit">操作审计</NavLink>
              <NavLink to="/bank/users">账号</NavLink>
            </div>
          ) : null}
        </nav>

        <main className="content">
          <Routes>
            <Route index element={<Navigate to="tasks" replace />} />
            <Route path="tasks" element={<TaskListPage />} />
            <Route path="report/:id" element={<ReportPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="templates/:id" element={<TemplateDetailPage />} />
            <Route path="templates/:id/layout" element={<TemplateLayoutPage />} />
            <Route path="metrics" element={<MetricDefsPage />} />
            <Route path="verifications" element={<VerificationDefsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route
              path="*"
              element={
                <ComingSoon
                  title="这个页面还没迁完"
                  detail="模板库、标注、风控参数、客户与账户、OCR 路由、看板仍在旧版里，迁移期间请用 /bank-old/ 访问。"
                />
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}
