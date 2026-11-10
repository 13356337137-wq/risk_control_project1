import { useEffect, useMemo, useState } from 'react';
import {
  evaluate,
  listFeatures,
  listOperators,
  listSamples,
  type EvaluateResult,
  type LabFeature,
  type LabOperator,
  type LabSample,
} from '../../api/lab';
import { getErrorMessage } from '../../api/errors';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

const FAMILY_LABEL: Record<string, string> = {
  numeric: '数值',
  logic: '逻辑与比较',
  group: '分组',
  window: '时间窗',
  filter: '过滤',
};

const EXAMPLES = [
  { label: '出账总额', expr: "sum(amount, where=direction=='out')" },
  { label: '月均出账', expr: 'sum(amount) / coverage_months()' },
  { label: '开方', expr: 'sqrt(sum(amount, where=direction==\'out\'))' },
  { label: '平方', expr: "pow(sum(amount, where=direction=='in') / 1000, 2)" },
  { label: '对数', expr: 'log10(sum(amount, where=direction==\'out\'))' },
  { label: '夜间占比', expr: "count(where=hour(trade_time)>=22) / count()" },
  { label: '月度序列积分', expr: 'integrate(monthly_values(agg=\'count\'))' },
  { label: '月度序列微分', expr: 'derivative(monthly_values(agg=\'count\'))' },
  { label: '条件判断', expr: "if_else(sum(amount, where=direction=='in') > 10000, '高收入', '普通')" },
];

/**
 * 特征 Lab。
 *
 * 这一页的存在理由：特征衍生（通用能力）与个人流水风控特征（域内口径）是两件事——
 * 前者是我们提供的算子与表达式引擎，后者是建立在它上面的具体口径。
 * Lab 把两者摆在一起：左边是算子与内置特征库，右边是随手试算。
 */
export default function LabPage() {
  const [operators, setOperators] = useState<LabOperator[]>([]);
  const [features, setFeatures] = useState<LabFeature[]>([]);
  const [samples, setSamples] = useState<LabSample[]>([]);
  const [sample, setSample] = useState('clean/icbc.pdf');
  const [expr, setExpr] = useState("sum(amount, where=direction=='out')");
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'features' | 'operators'>('features');

  useEffect(() => {
    Promise.all([listOperators(), listFeatures(), listSamples()])
      .then(([ops, defs, list]) => {
        setOperators(ops.items);
        setFeatures(defs.items);
        setSamples(list.items);
        if (list.items.length && !list.items.some((item) => item.name === sample)) {
          setSample(list.items[0].name);
        }
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, []);

  const grouped = useMemo(() => {
    const keyword = filter.trim();
    const out: Record<string, LabOperator[]> = {};
    for (const item of operators) {
      if (keyword && !item.key.includes(keyword) && !item.detail.includes(keyword)) continue;
      (out[item.family] ??= []).push(item);
    }
    return out;
  }, [operators, filter]);

  const shownFeatures = features.filter(
    (item) => !filter.trim() || item.code.includes(filter.trim()) || item.name.includes(filter.trim()),
  );

  async function run() {
    setBusy(true);
    setError('');
    try {
      setResult(await evaluate(sample, expr));
    } catch (err) {
      setResult(null);
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>特征 Lab</h1>
          <p className="sub">
            特征衍生是通用能力，风控特征是它的具体口径。这里左边是算子与内置特征，右边随手试算——
            试算只跑合成样本，不接触真实客户流水。
          </p>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}

      <div className="lab">
        <aside className="lab-side">
          <div className="tabs small-tabs">
            <button className={tab === 'features' ? 'active' : ''} onClick={() => setTab('features')}>
              内置特征（{features.length}）
            </button>
            <button className={tab === 'operators' ? 'active' : ''} onClick={() => setTab('operators')}>
              算子（{operators.length}）
            </button>
          </div>
          <input
            className="search lab-search"
            placeholder={tab === 'features' ? '搜索特征' : '搜索算子'}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />

          <div className="lab-list">
            {tab === 'features'
              ? shownFeatures.map((item) => (
                  <button
                    key={item.code}
                    className="lab-item"
                    onClick={() => setExpr(String(item.body))}
                    title="点击填入表达式"
                  >
                    <span className="lab-code">{item.code}</span>
                    <span className="lab-name">{item.name}</span>
                    <span className="muted small">{item.unit}</span>
                  </button>
                ))
              : Object.entries(grouped).map(([family, items]) => (
                  <div key={family} className="lab-group">
                    <span className="sider-title">{FAMILY_LABEL[family] ?? family}</span>
                    {items.map((item) => (
                      <button
                        key={item.key}
                        className="lab-item"
                        onClick={() => setExpr((prev) => insertOperator(prev, item.key))}
                        title={item.detail}
                      >
                        <span className="lab-code">{item.key}</span>
                        <span className="lab-name">{item.detail}</span>
                      </button>
                    ))}
                  </div>
                ))}
          </div>
        </aside>

        <section className="lab-main">
          <div className="lab-toolbar">
            <select value={sample} onChange={(event) => setSample(event.target.value)}>
              {samples.map((item) => (
                <option key={item.name} value={item.name}>{item.name}</option>
              ))}
            </select>
            <Button onClick={() => void run()} disabled={busy}>
              {busy ? '计算中…' : '运行'}
            </Button>
          </div>

          <textarea
            className="lab-editor"
            value={expr}
            spellCheck={false}
            onChange={(event) => setExpr(event.target.value)}
            rows={4}
          />

          <div className="lab-examples">
            {EXAMPLES.map((item) => (
              <button key={item.label} className="link-btn" onClick={() => setExpr(item.expr)}>
                {item.label}
              </button>
            ))}
          </div>

          {result ? (
            <div className="lab-result">
              <div className="score">
                <span className="score-value">{formatValue(result.value)}</span>
                <span className="muted small">
                  {result.type} · 样本 {result.rows} 笔
                </span>
              </div>
              {result.preview ? (
                <div className="scroll small">
                  <code>{JSON.stringify(result.preview)}</code>
                </div>
              ) : null}
              {result.notes.length ? (
                <ul className="plain">
                  {result.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="muted small">输入表达式后点运行。缺列的算子会返回空值并给出原因，不会填 0。</p>
          )}
        </section>
      </div>
    </div>
  );
}

function insertOperator(prev: string, key: string) {
  return prev.trim() ? prev + ' ' + key + '()' : key + '()';
}

function formatValue(value: EvaluateResult['value']) {
  if (value === null) return '空值';
  if (Array.isArray(value)) return '[' + value.map((item) => item ?? '空').join(', ') + ']';
  return String(value);
}
