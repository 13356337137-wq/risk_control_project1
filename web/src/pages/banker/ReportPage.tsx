import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getReport, getTransactions, type ReportPayload, type TxnRow } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

/**
 * 报告页：结论在最上，其余按「证据能撑住几层」的顺序排。
 *
 * 与初版对齐的部分：四层核验逐项、40 项指标按业务域分块、证据与材料、
 * 以及可以翻到每一笔的流水明细——只给一张结论卡片的报告，客户经理没法拿去答复审核。
 */
type Tab = 'summary' | 'verify' | 'metrics' | 'evidence' | 'txns';

const TABS: { key: Tab; label: string }[] = [
  { key: 'summary', label: '结论' },
  { key: 'verify', label: '四层核验' },
  { key: 'metrics', label: '指标' },
  { key: 'evidence', label: '证据与材料' },
  { key: 'txns', label: '交易流水' },
];

const DOMAIN: Record<string, string> = {
  A: '收入能力',
  B: '负债与还款',
  C: '资金往来',
  D: '异常与风险',
  E: '语义与场景',
};

export default function ReportPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('summary');
  const [txns, setTxns] = useState<TxnRow[] | null>(null);
  const [txnPage, setTxnPage] = useState(0);
  const [keyword, setKeyword] = useState('');
  // 证据里的 txn_id 是「第几笔」（1 起），不是数据库 id —— 后端生成证据时用的是 range(1, n+1)
  const [highlightRow, setHighlightRow] = useState<number | null>(null);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const PAGE = 100;

  useEffect(() => {
    let alive = true;
    getReport(taskId)
      .then((data) => alive && setReport(data))
      .catch((err) => alive && setError(getErrorMessage(err, 'banker')));
    return () => {
      alive = false;
    };
  }, [taskId]);

  useEffect(() => {
    if (tab !== 'txns' || txns) return;
    let alive = true;
    getTransactions(taskId)
      .then((rows) => alive && setTxns(rows))
      .catch((err) => alive && setError(getErrorMessage(err, 'banker')));
    return () => {
      alive = false;
    };
  }, [tab, taskId, txns]);

  const metrics = report?.metrics ?? [];
  const grouped = useMemo(() => {
    const out: Record<string, typeof metrics> = {};
    for (const metric of metrics) {
      const domain = DOMAIN[metric.code.slice(0, 1)] ?? '其它';
      (out[domain] ??= []).push(metric);
    }
    return out;
  }, [metrics]);

  // 证据跳过来时把那一行滚到视野中间，否则「看这笔」看起来像没反应
  useEffect(() => {
    if (tab === 'txns' && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [tab, highlightRow, txnPage, txns]);

  const filteredTxns = useMemo(() => {
    const rows = txns ?? [];
    const key = keyword.trim();
    if (!key) return rows;
    return rows.filter((row) =>
      [row.summary, row.counterparty_name, row.amount, row.balance, row.txn_date]
        .filter(Boolean)
        .some((field) => String(field).includes(key)),
    );
  }, [txns, keyword]);

  if (error && !report) {
    return (
      <div className="panel">
        <Notice>{error}</Notice>
        <Link className="btn btn-ghost" to="/bank/tasks">回到列表</Link>
      </div>
    );
  }
  if (!report) return <p className="muted">加载中…</p>;

  const score = report.scores?.overall;
  const valued = metrics.filter((metric) => metric.value !== null).length;

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>{report.verdict}</h1>
          <p className="sub">{report.verdict_reason}</p>
        </div>
        <div className="filters">
          <Link className="btn btn-ghost" to="/bank/tasks">回到列表</Link>
        </div>
      </header>

      <div className="score-row">
        <div className="score"><span className="score-value">{score ?? report.trust?.score ?? '—'}</span><span className="muted small">真实性得分</span></div>
        <div className="score"><span className="score-value">{report.scores?.grade_label ?? report.trust?.label ?? '—'}</span><span className="muted small">分级</span></div>
        <div className="score"><span className="score-value">{valued}/{metrics.length}</span><span className="muted small">指标有值</span></div>
        <div className="score"><span className="score-value">{report.materials?.length ?? 0}</span><span className="muted small">材料</span></div>
      </div>

      <div className="tabs small-tabs report-tabs">
        {TABS.map((item) => (
          <button key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <>
          {report.conclusions?.length ? (
            <section>
              <h2>结论依据</h2>
              <ul className="plain">
                {report.conclusions.map((item, index) => (
                  <li key={index}>
                    <strong>{item.code}</strong> {item.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2>四层概览</h2>
            <table className="grid compact">
              <thead><tr><th>层</th><th>状态</th><th>说明</th></tr></thead>
              <tbody>
                {(report.layers ?? []).map((layer) => (
                  <tr key={layer.layer}>
                    <td>{layerName(layer.layer)}</td>
                    <td>{layer.status}</td>
                    <td className="small muted">{layer.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">逐项看「怎么验、本次结果」，切到「四层核验」。</p>
          </section>

          {report.limitations?.length ? (
            <section>
              <h2>核验受限（{report.limitations.length}）</h2>
              <ul className="plain">
                {report.limitations.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {tab === 'verify' ? (
        <section>
          <h2>四层逐项</h2>
          {(report.layers ?? []).map((layer) => (
            <div key={layer.layer} className="verify-block">
              <h3>
                {layerName(layer.layer)} <span className="muted small">{layer.status}</span>
              </h3>
              <p className="small muted">{layer.detail}</p>
            </div>
          ))}
          {report.self_check ? (
            <>
              <h3>自检</h3>
              <pre className="json-box">{JSON.stringify(report.self_check, null, 2)}</pre>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'metrics' ? (
        <>
          {Object.entries(grouped).map(([domain, items]) => (
            <section key={domain}>
              <h2>
                {domain}（{items.filter((item) => item.value !== null).length}/{items.length} 有值）
              </h2>
              <table className="grid compact">
                <thead><tr><th>代号</th><th>指标</th><th>值</th><th>单位</th><th>口径</th></tr></thead>
                <tbody>
                  {items.map((metric) => (
                    <tr key={metric.code}>
                      <td>{metric.code}</td>
                      <td>{metric.name}</td>
                      <td className={metric.value === null ? 'muted' : ''}>{metric.value ?? '不可算'}</td>
                      <td className="small muted">{metric.unit}</td>
                      <td className="small muted">{metric.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      ) : null}

      {tab === 'evidence' ? (
        <>
          <section>
            <h2>证据（{report.evidence?.length ?? 0}）</h2>
            {report.evidence?.length ? (
              <>
                <p className="muted small">
                  每条证据 = 一次命中的位置：哪条规则、第几页、哪一笔、在页面上的坐标。点「看这笔」跳到交易流水。
                </p>
                <table className="grid compact">
                  <thead><tr><th>规则</th><th>页</th><th>笔号</th><th>位置</th><th /></tr></thead>
                  <tbody>
                    {report.evidence.map((raw, index) => {
                      const item = (raw ?? {}) as { rule_code?: string; page_no?: number; txn_id?: number; x?: number; y?: number };
                      return (
                        <tr key={index}>
                          <td>{item.rule_code ?? '—'}</td>
                          <td className="small muted">{item.page_no ?? '—'}</td>
                          <td className="small muted">{item.txn_id ?? '—'}</td>
                          <td className="small muted">
                            {item.x === undefined ? '—' : Math.round(item.x) + ', ' + Math.round(item.y ?? 0) + ' pt'}
                          </td>
                          <td>
                            {item.txn_id ? (
                              <button
                                className="link-btn"
                                onClick={() => {
                                  const rowNo = item.txn_id ?? null;
                                  setHighlightRow(rowNo);
                                  setKeyword('');
                                  if (rowNo) setTxnPage(Math.floor((rowNo - 1) / PAGE));
                                  setTab('txns');
                                }}
                              >
                                看这笔
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="muted small">这份报告没有独立证据条目（证据都并进了四层核验的说明里）。</p>
            )}
          </section>
          <section>
            <h2>材料（{report.materials?.length ?? 0}）</h2>
            <table className="grid compact">
              <thead><tr><th>角色</th><th>页数</th><th>校验</th></tr></thead>
              <tbody>
                {(report.materials ?? []).map((item, index) => (
                  <tr key={index}>
                    <td>{String(item.role)}</td>
                    <td>{String(item.pages)}</td>
                    <td className="small muted">{item.sha256 ? String(item.sha256).slice(0, 16) + '…' : '未记录'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      {tab === 'txns' ? (
        <section>
          <div className="filters" style={{ marginBottom: 10 }}>
            <input
              className="search"
              placeholder="搜索摘要 / 对方 / 金额 / 日期"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setTxnPage(0);
              }}
            />
            <span className="muted small">
              {txns === null ? '加载中…' : filteredTxns.length + ' 笔'}
            </span>
          </div>
          <table className="grid compact">
            <thead>
              <tr><th>日期</th><th>方向</th><th>金额</th><th>余额</th><th>摘要</th><th>对方</th><th>页</th></tr>
            </thead>
            <tbody>
              {filteredTxns.slice(txnPage * PAGE, txnPage * PAGE + PAGE).map((row, offset) => (
                <tr
                  key={row.id}
                  ref={highlightRow === txnPage * PAGE + offset + 1 ? highlightRef : undefined}
                  className={highlightRow === txnPage * PAGE + offset + 1 ? 'active-row' : ''}
                >
                  <td className="small">{row.txn_date ?? '—'}</td>
                  <td className="small">{row.direction === 'in' ? '入' : row.direction === 'out' ? '出' : '—'}</td>
                  <td>{row.amount ?? '—'}</td>
                  <td className="small muted">{row.balance ?? '—'}</td>
                  <td className="small">{row.summary ?? ''}</td>
                  <td className="small muted">{row.counterparty_name ?? ''}</td>
                  <td className="small muted">{row.page_no ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredTxns.length > PAGE ? (
            <div className="pager">
              <button className="btn btn-ghost" disabled={txnPage === 0} onClick={() => setTxnPage(txnPage - 1)}>上一页</button>
              <span className="muted small">
                第 {txnPage * PAGE + 1}–{Math.min((txnPage + 1) * PAGE, filteredTxns.length)} 笔 / 共 {filteredTxns.length} 笔
              </span>
              <button
                className="btn btn-ghost"
                disabled={(txnPage + 1) * PAGE >= filteredTxns.length}
                onClick={() => setTxnPage(txnPage + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function layerName(layer: string) {
  return { file: '载体层', content: '内容层', ledger: '账务层', external: '外部层' }[layer] ?? layer;
}
