import { useMemo } from 'react';

export interface Txn {
  id: number; txn_date: string | null; direction: string | null;
  amount: string | null; balance: string | null; summary: string | null;
}

const num = (v: string | null) => (v === null ? Number.NaN : Number(v));
const fmt = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const monthOf = (d: string | null) => (d ? d.slice(0, 7) : '未知');

export interface Insight {
  months: { month: string; income: number; expense: number }[];
  balancePoints: { date: string; balance: number }[];
  categories: { name: string; amount: number }[];
  count: number;
  income: number; expense: number; net: number;
  maxIn?: { date: string; amount: number; summary: string | null };
  maxOut?: { date: string; amount: number; summary: string | null };
  minBalance?: { date: string; balance: number };
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/工资|代发|薪/, '工资代发'],
  [/利息|结息/, '利息'],
  [/汇入|转入|入账/, '转入/汇入'],
  [/汇出|转出|汇款/, '转出/汇款'],
  [/消费|快捷|支付|商户/, '消费支付'],
  [/还款|贷款/, '贷款还款'],
  [/基金|理财|证券/, '投资理财'],
  [/退|冲正/, '退款/冲正'],
];

function categoryOf(summary: string | null): string {
  if (!summary) return '其他';
  for (const [re, name] of CATEGORY_RULES) if (re.test(summary)) return name;
  return '其他';
}

export function buildInsight(txns: Txn[]): Insight {
  const monthsMap = new Map<string, { income: number; expense: number }>();
  const catMap = new Map<string, number>();
  const points: { date: string; balance: number }[] = [];
  let income = 0, expense = 0;
  let maxIn: Insight['maxIn'], maxOut: Insight['maxOut'], minBalance: Insight['minBalance'];

  for (const t of txns) {
    const amt = num(t.amount);
    const dir = t.direction === 'in' ? 'in' : t.direction === 'out' ? 'out' : null;
    if (!Number.isNaN(amt) && dir) {
      const m = monthOf(t.txn_date);
      const cell = monthsMap.get(m) ?? { income: 0, expense: 0 };
      if (dir === 'in') { cell.income += amt; income += amt; } else { cell.expense += amt; expense += amt; }
      monthsMap.set(m, cell);
      catMap.set(categoryOf(t.summary), (catMap.get(categoryOf(t.summary)) ?? 0) + amt);
      if (dir === 'in' && amt > 0 && (!maxIn || amt > maxIn.amount)) maxIn = { date: t.txn_date ?? '', amount: amt, summary: t.summary };
      if (dir === 'out' && (!maxOut || amt > maxOut.amount)) maxOut = { date: t.txn_date ?? '', amount: amt, summary: t.summary };
    }
    const bal = num(t.balance);
    if (!Number.isNaN(bal) && t.txn_date) {
      points.push({ date: t.txn_date, balance: bal });
      if (!minBalance || bal < minBalance.balance) minBalance = { date: t.txn_date, balance: bal };
    }
  }

  return {
    months: [...monthsMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, ...v })),
    balancePoints: points,
    categories: [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([name, amount]) => ({ name, amount })),
    count: txns.length, income, expense, net: income - expense,
    maxIn, maxOut, minBalance,
  };
}

export function StatTiles({ data }: { data: Insight }) {
  const tiles = [
    { label: '交易笔数', value: `${data.count} 笔`, tone: '' },
    { label: '期间收入', value: `¥${fmt(data.income)}`, tone: 'good' },
    { label: '期间支出', value: `¥${fmt(data.expense)}`, tone: 'bad' },
    { label: '净流入', value: `¥${fmt(data.net)}`, tone: data.net >= 0 ? 'good' : 'bad' },
    { label: '最低余额', value: data.minBalance ? `¥${fmt(data.minBalance.balance)}` : '—', tone: 'warn' },
  ];
  return (
    <div className="tiles">
      {tiles.map(t => (
        <div key={t.label} className={`tile ${t.tone}`}>
          <div className="tile-label">{t.label}</div>
          <div className="tile-value">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

export function MonthlyFlowChart({ months }: { months: Insight['months'] }) {
  const W = 720, H = 260, PAD = { l: 56, r: 16, t: 18, b: 34 };
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expense]));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const slot = months.length ? iw / months.length : iw;
  const bw = Math.min(26, slot / 3);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="月度收支">
      {[0, 0.25, 0.5, 0.75, 1].map(k => (
        <g key={k}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(max * k)} y2={y(max * k)} stroke="#e6e9ef" />
          <text x={PAD.l - 8} y={y(max * k) + 4} textAnchor="end" className="axis">{fmt(Math.round(max * k))}</text>
        </g>
      ))}
      {months.map((m, i) => {
        const cx = PAD.l + slot * i + slot / 2;
        return (
          <g key={m.month}>
            <rect x={cx - bw - 2} y={y(m.income)} width={bw} height={Math.max(0, PAD.t + ih - y(m.income))} fill="#2f7d5d" rx="3" />
            <rect x={cx + 2} y={y(m.expense)} width={bw} height={Math.max(0, PAD.t + ih - y(m.expense))} fill="#c05a4a" rx="3" />
            <text x={cx} y={H - 12} textAnchor="middle" className="axis">{m.month.slice(2)}</text>
          </g>
        );
      })}
      <text x={W - PAD.r - 92} y={10} textAnchor="end" className="axis legend-good">■ 收入</text>
      <text x={W - PAD.r} y={10} textAnchor="end" className="axis legend-bad">■ 支出</text>
    </svg>
  );
}

export function BalanceChart({ data }: { data: Insight }) {
  const pts = data.balancePoints;
  const W = 720, H = 220, PAD = { l: 56, r: 16, t: 16, b: 30 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const max = Math.max(1, ...pts.map(p => p.balance));
  const min = Math.min(0, ...pts.map(p => p.balance));
  const x = (i: number) => PAD.l + (pts.length <= 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - ((v - min) / (max - min || 1)) * ih;
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const area = `${path} L${x(pts.length - 1).toFixed(1)},${PAD.t + ih} L${x(0).toFixed(1)},${PAD.t + ih} Z`;
  const low = data.minBalance;
  const lowIdx = low ? pts.findIndex(p => p.date === low.date && p.balance === low.balance) : -1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="余额走势">
      <defs><linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2f6fb3" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#2f6fb3" stopOpacity="0.02" />
      </linearGradient></defs>
      {[0, 0.5, 1].map(k => (
        <g key={k}>
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih * k} y2={PAD.t + ih * k} stroke="#e6e9ef" />
          <text x={PAD.l - 8} y={PAD.t + ih * k + 4} textAnchor="end" className="axis">{fmt(Math.round(max - (max - min) * k))}</text>
        </g>
      ))}
      <path d={area} fill="url(#balFill)" />
      <path d={path} fill="none" stroke="#2f6fb3" strokeWidth="1.6" />
      {lowIdx >= 0 && (
        <g>
          <circle cx={x(lowIdx)} cy={y(pts[lowIdx].balance)} r="4" fill="#c05a4a" />
          <text x={x(lowIdx) + 8} y={y(pts[lowIdx].balance) - 6} className="axis mark-bad">最低 {fmt(pts[lowIdx].balance)}（{pts[lowIdx].date}）</text>
        </g>
      )}
    </svg>
  );
}

export function CategoryBars({ items, total }: { items: Insight['categories']; total: number }) {
  const max = Math.max(1, ...items.map(i => i.amount));
  return (
    <div className="catbars">
      {items.map(i => (
        <div key={i.name} className="catbar">
          <span className="cat-name">{i.name}</span>
          <span className="cat-track"><span className="cat-fill" style={{ width: `${(i.amount / max) * 100}%` }} /></span>
          <span className="cat-val">¥{fmt(i.amount)}<em>{total > 0 ? `${((i.amount / total) * 100).toFixed(1)}%` : ''}</em></span>
        </div>
      ))}
    </div>
  );
}

export function InsightSection({ txns }: { txns: Txn[] }) {
  const data = useMemo(() => buildInsight(txns), [txns]);
  if (txns.length === 0) return <p className="muted">没有可用于可视化的明细。</p>;

  const spend = data.expense || 1;
  const topShare = data.categories.length ? (data.categories[0].amount / (data.income + data.expense || 1)) * 100 : 0;

  return (
    <section style={{ marginTop: 8 }}>
      <h3>资金全景</h3>
      <StatTiles data={data} />
      <p className="chart-note">图表按<b>明细全量</b>计算；下方指标按<b>剔除规则</b>计算（如剔除转账、冲正），两者数值可能略有差异，属口径不同而非矛盾。</p>

      <div className="chart-grid">
        <div className="chart-card">
          <h4>月度收支</h4>
          <MonthlyFlowChart months={data.months} />
          <p className="chart-note">柱高对比各月流入与流出；断档月份表示该月无交易。</p>
        </div>
        <div className="chart-card">
          <h4>余额走势（逐笔）</h4>
          <BalanceChart data={data} />
          <p className="chart-note">线越贴近底部说明账户越紧张；红点为期间最低余额。</p>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h4>摘要结构（按金额）</h4>
          <CategoryBars items={data.categories} total={data.income + data.expense} />
          <p className="chart-note">按摘要关键词归类，最大类占比 {topShare.toFixed(1)}%。</p>
        </div>
        <div className="chart-card">
          <h4>值得先看的三件事</h4>
          <ul className="insights">
            {data.maxOut && <li><b>最大单笔支出</b>：{data.maxOut.date} ¥{fmt(data.maxOut.amount)}（{data.maxOut.summary ?? '—'}）</li>}
            {data.maxIn && <li><b>最大单笔收入</b>：{data.maxIn.date} ¥{fmt(data.maxIn.amount)}（{data.maxIn.summary ?? '—'}）</li>}
            {data.minBalance && <li><b>余额最低</b>：{data.minBalance.date} ¥{fmt(data.minBalance.balance)}</li>}
            <li><b>支出/收入比</b>：{(data.expense / (data.income || 1) * 100).toFixed(0)}%{data.expense > spend * 0 ? '' : ''}</li>
          </ul>
          <p className="chart-note">图表只反映解析出的明细，未做任何推断；受限项见下方。</p>
        </div>
      </div>
    </section>
  );
}

