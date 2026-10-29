import { metricsDemo, rateDemo } from '../lib/demo';

export function MetricsView() {
  const d = metricsDemo;
  return (
    <div className="result">
      <div className="result-head">
        <h2>流水风控指标报告</h2>
        <span className="badge">任务 {d.task_id}</span>
        <span className="badge">载体 {d.carrier}</span>
        <span className="badge">指标集 v{d.metric_set_version}</span>
        <span className="badge">阈值 v{d.threshold_version}</span>
        <span className="badge muted">示例数据</span>
      </div>

      <h3>阈值触发的结论</h3>
      <div className="conclusions">
        {d.conclusions.map(c => (
          <div key={c.code} className={`conclusion ${c.level}`}>
            <div className="c-title">{c.label}</div>
            <div className="c-meta">
              阈值 {c.threshold} · 实际 {c.value} · {c.hint}
            </div>
          </div>
        ))}
      </div>
      <p className="muted">阈值由算法组定义默认值，银行可调；每次结论记 threshold_version，老报告不重写。</p>

      {d.groups.map(group => (
        <section key={group.key}>
          <h3>{group.key} · {group.name}</h3>
          <table className="mini">
            <thead>
              <tr><th>编码</th><th>指标</th><th>值</th><th>单位</th><th>口径说明</th><th>口径版本</th></tr>
            </thead>
            <tbody>
              {group.metrics.map(m => (
                <tr key={m.code}>
                  <td className="mono">{m.code}</td>
                  <td>{m.name}</td>
                  <td className="num">{m.value}</td>
                  <td>{m.unit || '—'}</td>
                  <td className="muted">{m.note}</td>
                  <td className="mono">v{m.caliber_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <h3>结息反算用的利率（示例）</h3>
      <table className="mini">
        <thead><tr><th>产品</th><th>年利率</th><th>起存金额</th></tr></thead>
        <tbody>
          {rateDemo.rates.map(r => (
            <tr key={r.product}><td>{r.product}</td><td className="num">{r.annual}</td><td className="num">{r.min_balance}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {rateDemo.note}　基准天数 {rateDemo.basis_days}，结息日 {rateDemo.settlement_days}。
      </p>
      <p className="muted">{d.note}</p>
    </div>
  );
}
