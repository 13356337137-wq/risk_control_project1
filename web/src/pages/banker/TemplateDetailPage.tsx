import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTemplate, getTemplateStats, type TemplateDetail, type TemplateStats } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

export default function TemplateDetailPage() {
  const { id } = useParams();
  const templateId = Number(id);
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [stats, setStats] = useState<TemplateStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getTemplate(templateId), getTemplateStats(templateId)])
      .then(([detail, statistics]) => {
        setTemplate(detail);
        setStats(statistics);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, [templateId]);

  if (error) return <div className="panel"><Notice>{error}</Notice></div>;
  if (!template) return <p className="muted">加载中…</p>;

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>
            {template.bank_code} v{template.version}
          </h1>
          <p className="sub">
            模板 #{template.id} · 状态 {template.status === 'enabled' ? '在用' : template.status === 'draft' ? '草稿' : template.status}
          </p>
        </div>
        <div className="filters">
          <Link className="btn btn-ghost" to={'/bank/templates/' + template.id + '/layout'}>看版式</Link>
          <Link className="btn btn-ghost" to="/bank/templates">回到列表</Link>
        </div>
      </header>

      <section className="score-row">
        <div className="score"><span className="score-value">{stats?.tasks_total ?? 0}</span><span className="muted small">用它的任务</span></div>
        <div className="score"><span className="score-value">{stats?.success_rate == null ? '—' : Math.round(stats.success_rate * 100) + '%'}</span><span className="muted small">成功率</span></div>
        <div className="score"><span className="score-value">{stats?.avg_txn_count ?? '—'}</span><span className="muted small">平均笔数</span></div>
        <div className="score"><span className="score-value">{stats?.zero_txn_tasks ?? 0}</span><span className="muted small">零笔任务</span></div>
      </section>

      <section>
        <h2>字段映射（{Object.keys(template.field_map ?? {}).length} 项）</h2>
        <table className="grid compact">
          <thead><tr><th>规范字段</th><th>对应表头/列</th></tr></thead>
          <tbody>
            {Object.entries(template.field_map ?? {}).map(([field, target]) => (
              <tr key={field}><td>{field}</td><td className="small muted">{String(target)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="muted small">
        零笔任务不为 0 说明模板在这批文件上没读出行——那是「模板不匹配」的信号，应该重采或加外推兜底。
      </p>
    </div>
  );
}
