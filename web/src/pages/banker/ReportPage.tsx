import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getReport, type ReportPayload } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

/**
 * 报告页：先给结论，再给依据。
 *
 * 顺序不是随手排的——客户经理多数时候只需要「能不能放」，
 * 四层与指标是他被问住时的证据，所以结论在最上、明细可折叠。
 */
export default function ReportPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getReport(taskId)
      .then((data) => alive && setReport(data))
      .catch((err) => alive && setError(getErrorMessage(err, 'banker')));
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (error) {
    return (
      <div className="panel">
        <Notice>{error}</Notice>
        <Link className="btn btn-ghost" to="/bank/tasks">回到列表</Link>
      </div>
    );
  }
  if (!report) return <p className="muted">加载中…</p>;

  const score = report.scores?.overall;
  const trust = report.trust;

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>{report.verdict}</h1>
          <p className="sub">{report.verdict_reason}</p>
        </div>
        <Link className="btn btn-ghost" to="/bank/tasks">回到列表</Link>
      </header>

      <section className="score-row">
        <div className="score">
          <span className="score-value">{score ?? trust?.score ?? '—'}</span>
          <span className="muted small">真实性得分</span>
        </div>
        <div className="score">
          <span className="score-value">{report.scores?.grade_label ?? trust?.label ?? '—'}</span>
          <span className="muted small">分级</span>
        </div>
        <div className="score">
          <span className="score-value">{report.metrics?.length ?? 0}</span>
          <span className="muted small">指标项</span>
        </div>
      </section>

      <section>
        <h2>四层核验</h2>
        <table className="grid">
          <thead>
            <tr><th>层</th><th>状态</th><th>说明</th></tr>
          </thead>
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
      </section>

      {report.limitations?.length ? (
        <section>
          <h2>核验受限说明</h2>
          <ul className="plain">
            {report.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2>指标（{report.metrics?.length ?? 0} 项）</h2>
        <div className="scroll">
          <table className="grid compact">
            <thead>
              <tr><th>代号</th><th>指标</th><th>值</th><th>说明</th></tr>
            </thead>
            <tbody>
              {(report.metrics ?? []).map((metric) => (
                <tr key={metric.code}>
                  <td>{metric.code}</td>
                  <td>{metric.name}</td>
                  <td className={metric.value === null ? 'muted' : ''}>{metric.value ?? '不可算'}</td>
                  <td className="small muted">{metric.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function layerName(layer: string) {
  return { file: '载体层', content: '内容层', ledger: '账务层', external: '外部层' }[layer] ?? layer;
}
