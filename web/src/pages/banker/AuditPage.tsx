import { useEffect, useState } from 'react';
import { listAudit, type AuditRow } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

export default function AuditPage() {
  const PAGE = 50;
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listAudit({ limit: PAGE, offset })
      .then((data) => {
        setRows(data.items);
        setTotal(data.total);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, [offset]);

  const shown = actionFilter.trim()
    ? rows.filter((r) => (r.action || '').toLowerCase().includes(actionFilter.trim().toLowerCase()) || (r.detail || '').toLowerCase().includes(actionFilter.trim().toLowerCase()))
    : rows;

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>操作审计</h1>
          <p className="sub">只读，不可修改或删除；共 {total} 条，当前第 {Math.floor(offset / PAGE) + 1} 页。</p>
        </div>
        <div className="filters">
          <input
            className="search"
            placeholder="筛选动作或详情"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          />
          <button type="button" className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>上一页</button>
          <button type="button" className="btn btn-ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>下一页</button>
        </div>
      </header>
      {error ? <Notice>{error}</Notice> : null}
      <div className="scroll">
        <table className="grid compact">
          <thead>
            <tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id}>
                <td className="small">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                <td>{row.actor_id ?? '系统'}</td>
                <td>{row.action}</td>
                <td className="small muted">{row.object_type ? row.object_type + '#' + (row.object_id ?? '') : '—'}</td>
                <td className="small muted">{row.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
