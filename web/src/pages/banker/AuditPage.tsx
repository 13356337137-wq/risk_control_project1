import { useEffect, useState } from 'react';
import { listAudit, type AuditRow } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    listAudit({ limit: 100 })
      .then((data) => {
        setRows(data.items);
        setTotal(data.total);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, []);

  return (
    <div className="panel wide">
      <h1>操作审计</h1>
      <p className="sub">只读，不可修改或删除；共 {total} 条，显示最近 {rows.length} 条。</p>
      {error ? <Notice>{error}</Notice> : null}
      <div className="scroll">
        <table className="grid compact">
          <thead>
            <tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
