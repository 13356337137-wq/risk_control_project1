import { Fragment, useEffect, useState } from 'react';
import { getMetricDefinitions, getReport, getTransactions, getVerificationDefinitions, listTasks, type MetricDef, type ReportPayload, type TaskRow, type TxnRow } from '../lib/api';
import { InsightSection } from './Charts';
import { MetricExplain } from './MetricExplain';
import { CheckTable } from './CheckTable';

const LAYER_NAMES: Record<string, string> = { file: '载体层', content: '内容层', ledger: '账务层', external: '外部层' };

type AuthLevel = 'pass' | 'partial' | 'fail' | 'unknown';

const AUTH_LABEL: Record<AuthLevel, string> = {
  pass: '已通过真实性校验',
  partial: '部分通过（存在受限项）',
  fail: '未通过真实性校验',
  unknown: '无法判定（核验受限）',
};

function authenticity(layers: { layer: string; status: string }[], carrier: string, limitations: string[]) {
  const statusOf = (name: string) => layers.find(l => l.layer === name)?.status ?? 'unavailable';
  const anyBad = layers.some(l => l.status === 'inconsistent');
  const allPass = ['file', 'content', 'ledger', 'external'].every(n => statusOf(n) === 'pass');
  let level: AuthLevel = allPass ? 'pass' : anyBad ? 'fail' : 'partial';
  if (carrier === 'screenshot') level = 'fail';
  if (carrier === 'image') level = 'unknown';
  const blocked = layers.filter(l => l.status !== 'pass').map(l => LAYER_NAMES[l.layer] ?? l.layer);
  return { level, label: AUTH_LABEL[level], blocked, limited: limitations.length };
}


export function TaskList() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [defs, setDefs] = useState<Record<string, MetricDef>>({});
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const [vmethods, setVmethods] = useState<Record<string, string>>({});

  async function refresh() {
    setLoading(true); setError('');
    try { setRows(await listTasks()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    getVerificationDefinitions()
      .then(d => setVmethods(Object.fromEntries(d.items.map(i => [i.code, i.method]))))
      .catch(() => setVmethods({}));
  }, []);

  useEffect(() => {
    getMetricDefinitions()
      .then(d => setDefs(Object.fromEntries(d.items.map(i => [i.code, i]))))
      .catch(() => setDefs({}));
  }, []);

  async function open(id: number) {
    setSelected(id); setReport(null); setTxns([]); setError('');
    try {
      const [rep, rows] = await Promise.all([getReport(id), getTransactions(id)]);
      setReport(rep); setTxns(rows);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="result-wrap">
      <div className="result">
        <div className="result-head">
          <h2>任务与报告</h2>
          <button className="btn" onClick={() => { void refresh(); }}>{loading ? '刷新中…' : '刷新'}</button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {rows.length === 0 && !loading && <p className="muted">还没有任务。借款人上传后这里会出现。</p>}
        {rows.length > 0 && (
          <table className="mini">
            <thead><tr><th>任务</th><th>业务号</th><th>状态</th><th>载体</th><th>创建时间</th><th></th></tr></thead>
            <tbody>
              {rows.map(t => (
                <tr key={t.id}>
                  <td className="mono">{t.id}</td>
                  <td className="mono">{t.biz_no}</td>
                  <td>{t.status}</td>
                  <td>{t.carrier ?? '—'}</td>
                  <td className="muted">{t.created_at ?? '—'}</td>
                  <td><button className="btn" onClick={() => { void open(t.id); }}>查看报告</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selected !== null && !report && !error && <p className="muted">正在读取任务 {selected} 的报告…</p>}
        {report && (
          <section style={{ marginTop: 22 }}>
            <div className={`verdict-card ${report.verdict === '未发现异常' ? 'ok' : 'bad'}`}>
              <div className="verdict-title">{report.verdict}</div>
              <div className="verdict-reason">{report.verdict_reason}</div>
            </div>
            <p className="muted">载体 {report.carrier} · 指标集 v{report.metric_set_version} · 阈值 v{report.threshold_version} · 材料 {report.materials.length} 份</p>

            {(() => {
              const a = authenticity(report.layers, report.carrier, report.limitations);
              return (
                <div className={"auth-card " + a.level}>
                  <div className="auth-line">
                    <span className="auth-badge">{a.level === 'pass' ? '✓' : a.level === 'fail' ? '✕' : '!'}</span>
                    <span className="auth-title">真实性校验：{a.label}</span>
                    <span className="auth-meta">载体 {report.carrier} · 受限 {a.limited} 项 · {a.blocked.length ? '未全通过：' + a.blocked.join('、') : '四层全部通过'}</span>
                  </div>
                  <div className="auth-chips">
                    {report.layers.map(l => (
                      <span key={l.layer} className={"chip " + l.status}>{LAYER_NAMES[l.layer] ?? l.layer} {l.status}</span>
                    ))}
                  </div>
                </div>
              );
            })()}

            <h3>阈值提示</h3>
            {report.conclusions.length === 0 ? <p className="muted">未触发</p> : (
              <div className="conclusions">
                {report.conclusions.map(c => (
                  <div key={c.code} className="conclusion info">
                    <div className="c-title">{c.code}</div>
                    <div className="c-meta">阈值 {c.threshold} · 实际 {c.value}</div>
                  </div>
                ))}
              </div>
            )}

            <InsightSection txns={txns} />

            <h3>指标（{report.metrics.filter(m => m.value !== null).length}/{report.metrics.length} 有值）</h3>
            <p className="muted">点任意一行展开：看这条指标怎么算、用了哪些输入、按原始数据画出来的图。</p>
            <table className="mini metric-table">
              <thead><tr><th></th><th>编码</th><th>指标</th><th>值</th><th>单位</th><th>口径说明</th></tr></thead>
              <tbody>
                {report.metrics.map(m => (
                  <Fragment key={m.code}>
                    <tr
                      className={'metric-row' + (openMetric === m.code ? ' open' : '')}
                      onClick={() => setOpenMetric(openMetric === m.code ? null : m.code)}
                    >
                      <td className="caret">{openMetric === m.code ? '▾' : '▸'}</td>
                      <td className="mono">{m.code}</td><td>{m.name}</td>
                      <td className="num">{m.value ?? '不可算'}</td><td>{m.unit ?? '—'}</td>
                      <td className="muted">{m.note ?? '—'}</td>
                    </tr>
                    {openMetric === m.code && (
                      <tr className="metric-detail-row">
                        <td />
                        <td colSpan={5}>
                          <MetricExplain metric={m} def={defs[m.code]} trend={report.trend ?? []} txns={txns} metricSetVersion={report.metric_set_version} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>

            <details className="auth-detail">
              <summary>真实性校验明细（默认收起，点开看四层检查、受限说明与证据）</summary>
              <h3>四层核验（点开任一检查点看「怎么验」和本次结果）</h3>
              {report.layers.map(l => (
                <div key={l.layer} className="layer-block">
                  <div className="layer-head">
                    <span className={'check-status ' + l.status}>{l.status}</span>
                    <strong>{LAYER_NAMES[l.layer] ?? l.layer}</strong>
                    <span className="muted">{l.detail}</span>
                  </div>
                  <CheckTable items={l.checks ?? []} methods={vmethods} />
                </div>
              ))}

              <h3>识别自检（S0–S7）</h3>
              <p className="muted">检查「系统有没有把这份文件读对」，与伪造判断分开看。</p>
              <CheckTable items={report.self_check ?? []} methods={vmethods} />


            <h3>核验受限（{report.limitations.length}）</h3>
            <ul className="muted">{report.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul>

            <h3>证据（{report.evidence.length}）</h3>
            {report.evidence.length === 0 ? <p className="muted">本报告无证据项。</p> : (
              <table className="mini">
                <thead><tr><th>交易</th><th>规则</th><th>页码</th><th>坐标</th></tr></thead>
                <tbody>
                  {report.evidence.slice(0, 50).map((e, i) => (
                    <tr key={i}><td className="mono">{e.txn_id ?? '—'}</td><td className="mono">{e.rule_code}</td><td>{e.page_no}</td><td className="mono">{e.x.toFixed(4)}, {e.y.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            </details>
          </section>
        )}
      </div>
    </div>
  );
}

