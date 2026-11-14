import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  getTemplate,
  getTemplateStats,
  previewTemplate,
  updateTemplateRequired,
  type TemplateDetail,
  type TemplatePreview,
  type TemplateStats,
} from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { getUser } from '../../auth/store';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

/** 可声明的必需列：这份版式里「一定要有的列」。缺了要在这儿说清，而不是让指标一片不可算。 */
const CANDIDATES = [
  'txn_date', 'trade_time', 'reference_no', 'summary', 'counterparty_name',
  'direction', 'amount', 'amount_in', 'amount_out', 'balance', 'account_no',
];

const FIELD_LABEL: Record<string, string> = {
  txn_date: '交易日期', trade_time: '交易时间', reference_no: '流水号', summary: '摘要',
  counterparty_name: '对方户名', direction: '借贷标志', amount: '交易金额',
  amount_in: '收入金额', amount_out: '支出金额', balance: '余额', account_no: '卡号/账号',
};

export default function TemplateDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const templateId = Number(id);
  const isAdmin = Boolean(getUser()?.is_admin);

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [stats, setStats] = useState<TemplateStats | null>(null);
  const [required, setRequired] = useState<string[]>([]);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    Promise.all([getTemplate(templateId), getTemplateStats(templateId)])
      .then(([detail, statistics]) => {
        setTemplate(detail);
        setStats(statistics);
        // 默认只要最必要的三列：全选会让「某一列本来就没值」也报缺列
        setRequired(detail.required_fields ?? ['txn_date', 'amount', 'balance']);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  };

  useEffect(load, [templateId]);

  async function onPreview(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError('');
    setMessage('');
    setPreview(null);
    try {
      const result = await previewTemplate(templateId, file, password || undefined);
      setPreview(result);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'E_ENCRYPT') setMessage('这份 PDF 设有打开口令，填在下面再试一次。');
      else setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  async function saveRequired() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await updateTemplateRequired(templateId, required);
      // 改必需列 = 出新版本（旧版本保留），所以要跳到新 id，否则页面读回的还是旧值
      setMessage('必需列已保存为模板 #' + result.id + '（v' + result.version + ' 草稿，旧版本保留）。');
      navigate('/bank/templates/' + result.id, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !template) return <div className="panel"><Notice>{error}</Notice></div>;
  if (!template) return <p className="muted">加载中…</p>;

  const mapped = Object.keys(template.field_map ?? {});

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>{template.bank_code} v{template.version}</h1>
          <p className="sub">
            模板 #{template.id} · 状态 {template.status === 'enabled' ? '在用' : template.status === 'draft' ? '草稿' : '停用'}
            {' '}· 已标 {mapped.length} 列
          </p>
        </div>
        <div className="filters">
          <Link className="btn btn-ghost" to={'/bank/templates/' + template.id + '/layout'}>看版式</Link>
          <button className="btn btn-ghost" onClick={() => navigate('/bank/annotate')}>重新标注</button>
          <Link className="btn btn-ghost" to="/bank/templates">回到列表</Link>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      <section className="score-row">
        <div className="score"><span className="score-value">{stats?.tasks_total ?? 0}</span><span className="muted small">用它的任务</span></div>
        <div className="score"><span className="score-value">{stats?.success_rate == null ? '—' : Math.round(stats.success_rate * 100) + '%'}</span><span className="muted small">成功率</span></div>
        <div className="score"><span className="score-value">{stats?.avg_txn_count ?? '—'}</span><span className="muted small">平均笔数</span></div>
        <div className="score"><span className="score-value">{stats?.zero_txn_tasks ?? 0}</span><span className="muted small">零笔任务</span></div>
      </section>

      {/* 试跑：模板保存完就能验，不必去借款侧走一遍真任务 */}
      <section>
        <h2>试跑（可选，不落库）</h2>
        <p className="muted small">
          拿一份该银行的文件试一遍：能出几笔、每页各几笔、缺了哪些必需列。这一步不通，就别启用。
        </p>
        <div className="try-row">
          <input type="file" accept=".pdf" onChange={(event) => void onPreview(event.target.files?.[0] ?? null)} />
          <input
            type="password"
            placeholder="口令（加密件才填）"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {busy ? <span className="muted small">试跑中…</span> : null}
        </div>

        {preview ? (
          <div className="try-result">
            <div className="score-row">
              <div className="score"><span className="score-value">{preview.txn_count}</span><span className="muted small">读出笔数</span></div>
              <div className="score"><span className="score-value">{preview.page_count}</span><span className="muted small">页数</span></div>
              <div className="score"><span className="score-value">{preview.present_columns.length}</span><span className="muted small">命中列</span></div>
              <div className="score">
                <span className={'score-value' + (preview.missing_columns.length ? ' bad' : '')}>
                  {preview.missing_columns.length + preview.empty_columns.length}
                </span>
                <span className="muted small">缺列</span>
              </div>
            </div>

            {preview.missing_columns.length || preview.empty_columns.length ? (
              <Notice>
                未读到：{preview.missing_columns.concat(preview.empty_columns).map((f) => FIELD_LABEL[f] ?? f).join('、')}
                。未标注的列去「重新标注」补上；标了但读不到，多半是列带位置偏了。
              </Notice>
            ) : (
              <p className="muted small">必需列都读到了。</p>
            )}

            {preview.warnings.length ? (
              <ul className="plain">
                {preview.warnings.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            ) : null}

            <table className="grid compact">
              <thead><tr><th>页</th><th>笔数</th><th>页眉</th></tr></thead>
              <tbody>
                {preview.pages.map((page) => (
                  <tr key={page.page_no}>
                    <td>{page.page_no + 1}</td>
                    <td>{page.rows}</td>
                    <td className="small muted">{page.header_found ? '识别到' : '未识别'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="grid compact">
              <thead><tr><th>日期</th><th>方向</th><th>金额</th><th>余额</th><th>摘要</th><th>页</th></tr></thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={index}>
                    <td className="small">{row.txn_date ?? '—'}</td>
                    <td className="small">{row.direction === 'in' ? '入' : row.direction === 'out' ? '出' : '—'}</td>
                    <td>{row.amount ?? '—'}</td>
                    <td className="small muted">{row.balance ?? '—'}</td>
                    <td className="small">{row.summary ?? ''}</td>
                    <td className="small muted">{pageNo(row.page_no)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* 必需列 */}
      <section>
        <h2>必需列（可选，{required.length}）</h2>
        <p className="muted small">
          勾上「这份版式一定有的列」。解析时若没读到，报告会直接写「模板缺列：xxx」，而不是让指标悄悄变成不可算。
        </p>
        <div className="chips">
          {CANDIDATES.map((field) => {
            const on = required.includes(field);
            return (
              <button
                key={field}
                className={'chip' + (on ? ' chip-on' : '')}
                disabled={!isAdmin}
                onClick={() => setRequired(on ? required.filter((f) => f !== field) : [...required, field])}
              >
                {FIELD_LABEL[field] ?? field}
              </button>
            );
          })}
        </div>
        {isAdmin ? (
          <div className="actions">
            <Button onClick={() => void saveRequired()} disabled={busy}>保存必需列（出新版本）</Button>
          </div>
        ) : (
          <p className="muted small">只读（需管理员）</p>
        )}
      </section>

      <section>
        <h2>字段映射（{mapped.length} 项）</h2>
        <table className="grid compact">
          <thead><tr><th>规范字段</th><th>对应列</th><th>必需</th></tr></thead>
          <tbody>
            {Object.entries(template.field_map ?? {}).map(([field, target]) => (
              <tr key={field}>
                <td title={field}>{FIELD_LABEL[field] ?? field}</td>
                <td className="small muted">{String(target)}</td>
                <td className="small muted">{required.includes(field) ? '是' : ''}</td>
              </tr>
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

function pageNo(value: number) {
  return Number.isFinite(value) ? value + 1 : '—';
}
