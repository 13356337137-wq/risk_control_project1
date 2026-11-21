/** 报告里的小图表：只用 SVG，不引图表库（几百 KB 不值当，图形只有三四种）。 */

export function Bar({
  value,
  max = 100,
  tone = 'brand',
}: {
  value: number;
  max?: number;
  tone?: 'brand' | 'warn' | 'bad' | 'muted';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = { brand: '#2563eb', warn: '#d97706', bad: '#b91c1c', muted: '#94a3b8' }[tone];
  return (
    <span className="bar-track" title={String(value)}>
      <span className="bar-fill" style={{ width: pct + '%', background: color }} />
    </span>
  );
}

/** 业务域五维雷达图。 */
export function DomainRadar({ domains }: { domains: { key: string; name: string; score: number }[] }) {
  if (!domains || domains.length < 3) return null;
  const cx = 140;
  const cy = 125;
  const rMax = 78;
  const n = domains.length;
  const pt = (idx: number, ratio: number) => {
    const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / n;
    return [cx + Math.cos(angle) * rMax * ratio, cy + Math.sin(angle) * rMax * ratio];
  };
  const dataPoints = domains.map((d, i) => pt(i, Math.max(0.05, Math.min(1, (d.score ?? 0) / 100))));

  return (
    <svg className="radar-chart" viewBox="0 0 280 250" role="img" aria-label="业务域得分雷达图">
      {[0.25, 0.5, 0.75, 1].map((lv) => (
        <polygon
          key={lv}
          points={domains.map((_, i) => pt(i, lv).join(',')).join(' ')}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
      ))}
      {domains.map((d, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.24);
        return (
          <g key={d.key}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#334155">
              {d.name}
            </text>
          </g>
        );
      })}
      <polygon
        points={dataPoints.map((p) => p.join(',')).join(' ')}
        fill="rgba(37, 99, 235, 0.16)"
        stroke="#2563eb"
        strokeWidth="2"
      />
      {dataPoints.map(([x, y], i) => (
        <circle key={domains[i].key} cx={x} cy={y} r="3.5" fill="#1d4ed8">
          <title>{`${domains[i].name}: ${domains[i].score}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** 月度收支：柱状（收入/支出）+ 净额折线。 */
export function MonthlyFlow({ series }: { series: { month: string; income: string; expense: string }[] }) {
  if (!series.length) return <p className="muted small">没有月度数据。</p>;
  const W = 720;
  const H = 200;
  const PAD = { l: 8, r: 8, t: 12, b: 26 };
  const width = W - PAD.l - PAD.r;
  const height = H - PAD.t - PAD.b;
  const income = series.map((item) => Number(item.income || 0));
  const expense = series.map((item) => Number(item.expense || 0));
  const max = Math.max(...income, ...expense, 1);
  const slot = width / series.length;
  const barW = Math.max(3, slot * 0.34);
  const net = income.map((value, index) => value - expense[index]);
  const netMax = Math.max(...net.map(Math.abs), 1);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="月度收支">
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <line
          key={ratio}
          x1={PAD.l}
          x2={W - PAD.r}
          y1={PAD.t + height * (1 - ratio)}
          y2={PAD.t + height * (1 - ratio)}
          stroke="#e5eaf2"
          strokeWidth="1"
        />
      ))}
      {series.map((item, index) => {
        const x = PAD.l + index * slot;
        const inH = (income[index] / max) * height;
        const outH = (expense[index] / max) * height;
        return (
          <g key={item.month}>
            <rect x={x + slot * 0.12} y={PAD.t + height - inH} width={barW} height={inH} fill="#2563eb" rx="2" />
            <rect x={x + slot * 0.12 + barW + 2} y={PAD.t + height - outH} width={barW} height={outH} fill="#f59e0b" rx="2" />
            <text x={x + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#94a3b8">
              {item.month.slice(2)}
            </text>
          </g>
        );
      })}
      <polyline
        fill="none"
        stroke="#0f172a"
        strokeWidth="1.4"
        strokeDasharray="4 3"
        points={net
          .map((value, index) => {
            const x = PAD.l + index * slot + slot / 2;
            const y = PAD.t + height / 2 - (value / netMax) * (height / 2 - 4);
            return x + ',' + y;
          })
          .join(' ')}
      />
      <text x={PAD.l} y={PAD.t + 10} fontSize="10" fill="#2563eb">收入</text>
      <text x={PAD.l + 30} y={PAD.t + 10} fontSize="10" fill="#f59e0b">支出</text>
      <text x={PAD.l + 60} y={PAD.t + 10} fontSize="10" fill="#0f172a">净额（虚线）</text>
    </svg>
  );
}

/** 金额分布：按数量级分桶，看钱集中在小额还是大额。 */
export function AmountHistogram({ amounts }: { amounts: number[] }) {
  const buckets = [
    { label: '<1千', min: 0, max: 1000 },
    { label: '1千–1万', min: 1000, max: 10000 },
    { label: '1万–5万', min: 10000, max: 50000 },
    { label: '5万–20万', min: 50000, max: 200000 },
    { label: '≥20万', min: 200000, max: Infinity },
  ];
  const counts = buckets.map((bucket) => amounts.filter((v) => Math.abs(v) >= bucket.min && Math.abs(v) < bucket.max).length);
  const max = Math.max(...counts, 1);
  const total = amounts.length || 1;

  return (
    <table className="grid compact chart-table">
      <thead><tr><th>金额区间</th><th>笔数</th><th>占比</th></tr></thead>
      <tbody>
        {buckets.map((bucket, index) => (
          <tr key={bucket.label}>
            <td>{bucket.label}</td>
            <td>{counts[index]}</td>
            <td>
              <span className="bar-inline">
                <Bar value={counts[index]} max={max} />
                <span className="muted small">{Math.round((counts[index] / total) * 100)}%</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
