import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  deleteTemplate,
  disableTemplate,
  duplicateTemplate,
  exportTemplateBlob,
  importTemplate,
  listTemplates,
  publishTemplate,
  restoreTemplate,
  type TemplateRow,
} from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { getUser } from '../../auth/store';
import { bankLabel } from '../../components/annotate/types';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

type Tab = 'active' | 'draft' | 'disabled' | 'trash';

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
  const [search, setSearch] = useState('');
  const [bankFilter, setBankFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const load = () => {
    listTemplates(true)
      .then(setRows)
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  };

  useEffect(load, []);

  const banks = Array.from(new Set(rows.map((r) => r.bank_code))).sort();

  const shown = rows.filter((row) => {
    if (tab === 'trash') {
      if (!row.deleted_at) return false;
    } else {
      if (row.deleted_at) return false;
      if (tab === 'active' && row.status !== 'enabled') return false;
      if (tab === 'draft' && row.status !== 'draft') return false;
      if (tab === 'disabled' && row.status !== 'disabled') return false;
    }
    if (bankFilter && row.bank_code !== bankFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hit =
        String(row.id).includes(q) ||
        row.bank_code.toLowerCase().includes(q) ||
        bankLabel(row.bank_code).toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  async function act(id: number, action: () => Promise<unknown>, okMsg?: string) {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await action();
      if (okMsg) setNotice(okMsg);
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(null);
    }
  }

  async function onExport(row: TemplateRow) {
    try {
      const blob = await exportTemplateBlob(row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `template-${row.bank_code}-v${row.version}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    }
  }

  async function onImportSubmit() {
    setError('');
    setNotice('');
    try {
      const payload = JSON.parse(importText) as Record<string, unknown>;
      const res = await importTemplate(payload);
      setImportOpen(false);
      setImportText('');
      setTab('draft');
      setNotice(`已导入模板 #${res.id}（${res.bank_code} v${res.version}，草稿状态）。`);
      load();
    } catch (err) {
      setError((err as Error).message || '导入 JSON 失败，请检查格式');
    }
  }

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>模板库</h1>
          <p className="sub">模板决定特定银行版式的几何列框与单值抽取策略；支持画布微调、实时试跑与版本迭代，删除仅软入回收站。</p>
        </div>
        <div className="filters">
          <Button size="sm" onClick={() => navigate('/bank/annotate')}>
            + 画布新建标注
          </Button>
          {isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => setImportOpen((v) => !v)}>
              导入 JSON
            </Button>
          )}
        </div>
      </header>

      <div className="filters-bar">
        <div className="tabs small-tabs">
          {([
            ['active', '在用'],
            ['draft', '草稿'],
            ['disabled', '已停用'],
            ['trash', '回收站'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="filters">
          <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)} aria-label="按银行筛选">
            <option value="">全部银行</option>
            {banks.map((b) => (
              <option key={b} value={b}>{bankLabel(b)} ({b})</option>
            ))}
          </select>
          <input
            type="search"
            placeholder="搜编号 / 银行名称或代码"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? <Notice>{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}

      {importOpen && (
        <div className="import-box">
          <div className="import-box-head">
            <strong>导入模板 JSON（粘贴导出文件或上传 .json）</strong>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) f.text().then(setImportText);
              }}
            />
          </div>
          <textarea
            rows={6}
            value={importText}
            placeholder='{"bank_code":"CCB","field_map":{"txn_date":"交易日期",...},"layout":{...}}'
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="actions">
            <Button size="sm" onClick={() => void onImportSubmit()}>确认导入为草稿</Button>
            <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>取消</Button>
          </div>
        </div>
      )}

      <table className="grid">
        <thead>
          <tr><th>编号</th><th>银行</th><th>版本</th><th>状态</th><th>框选与样本</th><th>字段</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id}>
              <td>#{row.id}</td>
              <td>{bankLabel(row.bank_code)} <span className="small muted">{row.bank_code}</span></td>
              <td>v{row.version}</td>
              <td><span className={'pill ' + (row.status === 'enabled' ? 'ok' : row.status === 'draft' ? 'warn' : '')}>{statusLabel(row)}</span></td>
              <td className="small">
                <span className={row.has_layout ? 'pill ok' : 'pill'}>{row.has_layout ? '有框选布局' : '仅列映射'}</span>
                {' '}
                {row.has_sample && <span className="pill ok">含样本</span>}
              </td>
              <td className="small muted">{Object.keys(row.field_map ?? {}).length} 项</td>
              <td className="small muted">{row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</td>
              <td className="small actions-cell">
                <Link className="link-btn" to={'/bank/templates/' + row.id}>详情</Link>
                <button className="link-btn" onClick={() => navigate('/bank/annotate?templateId=' + row.id)}>
                  画布编辑
                </button>
                <button className="link-btn" onClick={() => navigate('/bank/templates/' + row.id + '/layout')}>
                  版式图
                </button>
                <button className="link-btn" onClick={() => void onExport(row)}>
                  导出
                </button>
                {row.deleted_at ? (
                  isAdmin ? (
                    <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => restoreTemplate(row.id), `已恢复模板 #${row.id}`)}>
                      恢复
                    </button>
                  ) : null
                ) : (
                  <>
                    {isAdmin && row.status !== 'enabled' ? (
                      <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => publishTemplate(row.id), `已启用模板 #${row.id}`)}>
                        启用
                      </button>
                    ) : null}
                    {isAdmin && row.status === 'enabled' ? (
                      <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => disableTemplate(row.id), `已停用模板 #${row.id}`)}>
                        停用
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button className="link-btn" disabled={busy === row.id} onClick={() => void act(row.id, () => duplicateTemplate(row.id), `已复制模板 #${row.id} 为新草稿`)}>
                        复制
                      </button>
                    ) : null}
                    {isAdmin ? (
                      <button
                        className="link-btn danger"
                        disabled={busy === row.id}
                        onClick={() => void act(row.id, () => deleteTemplate(row.id), `模板 #${row.id} 已移入回收站`)}
                      >
                        移入回收站
                      </button>
                    ) : null}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 ? <p className="muted">当前筛选下没有模板。</p> : null}
    </div>
  );
}
