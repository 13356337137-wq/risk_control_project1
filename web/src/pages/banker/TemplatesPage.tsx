import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  deleteTemplate,
  disableTemplate,
  duplicateTemplate,
  listTemplates,
  publishTemplate,
  restoreTemplate,
  type TemplateRow,
} from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { getUser } from '../../auth/store';
import { Notice } from '../../ui/Notice';

type Tab = 'active' | 'draft' | 'trash';

function statusLabel(row: TemplateRow) {
  if (row.deleted_at) return '已删除';
  if (row.status === 'enabled') return '在用';
  if (row.status === 'draft') return '草稿';
  if (row.status === 'disabled') return '停用';
  return row.status;
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const isAdmin = Boolean(getUser()?.is_admin);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  const load = () => {
    listTemplates(true)
      .then(setRows)
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  };

  useEffect(load, []);

  const shown = rows.filter((row) => {
    if (tab === 'trash') return Boolean(row.deleted_at);
    if (row.deleted_at) return false;
    return tab === 'active' ? row.status === 'enabled' : row.status === 'draft';
  });

  async function act(id: number, action: () => Promise<unknown>) {
    setBusy(id);
    setError('');
    try {
      await action();
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>模板库</h1>
          <p className="sub">模板是加速层：命中它就走快通道，不命中还有外推兜底。删除一律软删除，进回收站可恢复。</p>
        </div>
        <div className="filters">
          <div className="tabs small-tabs">
            {(['active', 'draft', 'trash'] as Tab[]).map((key) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
                {key === 'active' ? '在用' : key === 'draft' ? '草稿' : '回收站'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}

      <table className="grid">
        <thead>
          <tr><th>编号</th><th>银行</th><th>版本</th><th>状态</th><th>字段</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id}>
              <td>#{row.id}</td>
              <td>{row.bank_code}</td>
              <td>v{row.version}</td>
              <td>{statusLabel(row)}</td>
              <td className="small muted">{Object.keys(row.field_map ?? {}).length} 项</td>
              <td className="small muted">{row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</td>
              <td className="small">
                <Link className="link-btn" to={'/bank/templates/' + row.id}>详情</Link>
                {row.deleted_at ? (
                  isAdmin ? (
                    <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => restoreTemplate(row.id))}>
                      恢复
                    </button>
                  ) : null
                ) : (
                  <>
                    {isAdmin && row.status !== 'enabled' ? (
                      <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => publishTemplate(row.id))}>
                        启用
                      </button>
                    ) : null}
                    {isAdmin && row.status === 'enabled' ? (
                      <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => disableTemplate(row.id))}>
                        停用
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => duplicateTemplate(row.id))}>
                        复制
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button
                        className="link-btn danger"
                        disabled={busy === row.id}
                        onClick={() => void act(row.id, () => deleteTemplate(row.id))}
                      >
                        移入回收站
                      </button>
                    ) : null}
                  </>
                )}
                <button className="link-btn" onClick={() => navigate('/bank/templates/' + row.id + '/layout')}>
                  版式
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 ? <p className="muted">这一栏没有模板。</p> : null}
    </div>
  );
}
