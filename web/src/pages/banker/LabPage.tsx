import { useEffect, useMemo, useState } from 'react';
import {
  deleteCustom,
  evaluate,
  evaluateCode,
  listCustom,
  listFeatures,
  listOperators,
  listSamples,
  saveCustom,
  type CustomFeature,
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

const COLUMNS = [
  { name: 'amount', note: '金额（Decimal，带正负）' },
  { name: 'direction', note: "'in' 入账 / 'out' 出账" },
  { name: 'balance', note: '余额' },
  { name: 'summary', note: '摘要（文本）' },
  { name: 'counterparty_name', note: '对方户名' },
  { name: 'txn_date', note: '交易日期 YYYY-MM-DD' },
  { name: 'trade_time', note: '交易时分 HH:MM:SS' },
  { name: 'reference_no', note: '流水号' },
  { name: 'hour', note: '小时（0–23，来自 trade_time）' },
  { name: 'month', note: '月份（1–12）' },
  { name: 'dow', note: '星期（0 = 周一）' },
];

const NOTES = [
  "聚合要带 where：count(where=direction=='out')，不写 where 就是全部行。",
  "文本要用引号：in_lexicon(name='salary')、contains(word='工资')。",
  "产出是一列数的算子（zscore / pct_rank / in_hours / contains）要跟比较或聚合搭配：count(where=zscore() > 3)。",
  "缺列不报 0，返回空值 + 原因；报告里会写成「不可算」，不会悄悄算成 0。",
];

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
  const [tab, setTab] = useState<'features' | 'operators' | 'custom'>('features');
  const [custom, setCustom] = useState<CustomFeature[]>([]);
  const [saveCode, setSaveCode] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveUnit, setSaveUnit] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [activeOp, setActiveOp] = useState<LabOperator | null>(null);

  const reloadCustom = () => {
    listCustom()
      .then((data) => setCustom(data.items))
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  };

  useEffect(() => {
    Promise.all([listOperators(), listFeatures(), listSamples()])
      .then(([ops, defs, list]) => {
        setOperators(ops.items);
        setFeatures(defs.items);
        setSamples(list.items);
        reloadCustom();
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

  void filter;

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
            <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
              自定义（{custom.length}）
            </button>
          </div>
          <input
            className="search lab-search"
            placeholder={tab === 'features' ? '搜索特征' : tab === 'operators' ? '搜索算子' : '搜索自定义特征'}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />

          <div className="lab-list">
            {tab === 'custom' ? (
              custom.length ? (
                custom.map((item) => (
                  <div key={item.code} className="lab-item lab-custom">
                    <span className="lab-code">{item.code}</span>
                    <span className="lab-name">{item.name} · v{item.version}</span>
                    <span className="lab-actions">
                      <button className="link-btn" onClick={() => { setExpr(item.expr); setSample(sample); }}>
                        填入
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => {
                          evaluateCode(sample, item.code)
                            .then(setResult)
                            .catch((err) => setError(getErrorMessage(err, 'banker')));
                        }}
                      >
                        运行
                      </button>
                      <button
                        className="link-btn danger"
                        onClick={() => {
                          deleteCustom(item.code)
                            .then(reloadCustom)
                            .catch((err) => setError(getErrorMessage(err, 'banker')));
                        }}
                      >
                        删除
                      </button>
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted small">还没有自定义特征。在右边写好表达式后点「保存为特征」。</p>
              )
            ) : tab === 'features'
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
                        className={'lab-item' + (activeOp?.key === item.key ? ' active' : '')}
                        onClick={() => {
                          setActiveOp(item);
                          setExpr((prev) => insertOperator(prev, item.key));
                        }}
                        title={item.detail}
                      >
                        <span className="lab-code">{signature(item)}</span>
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

          <div className="lab-guide">
            <div className="lab-guide-block">
              <span className="lab-guide-title">可用字段（点一下插入）</span>
              <div className="chips">
                {COLUMNS.map((column) => (
                  <button
                    key={column.name}
                    className="chip"
                    title={column.note}
                    onClick={() => setExpr((prev) => (prev.trim() ? prev + ' ' + column.name : column.name))}
                  >
                    {column.name}
                  </button>
                ))}
              </div>
            </div>

            {activeOp ? (
              <div className="lab-guide-block">
                <span className="lab-guide-title">
                  {activeOp.key} · {FAMILY_LABEL[activeOp.family] ?? activeOp.family} · {activeOp.kind}
                </span>
                <p className="small muted">{activeOp.detail}</p>
                {activeOp.params.length ? (
                  <table className="grid compact">
                    <thead><tr><th>参数</th><th>类型</th><th>默认</th><th>说明</th></tr></thead>
                    <tbody>
                      {activeOp.params.map((param) => (
                        <tr key={param.name}>
                          <td><code>{param.name}</code></td>
                          <td className="small muted">{param.type}</td>
                          <td className="small muted">{param.default === null || param.default === undefined ? '—' : String(param.default)}</td>
                          <td className="small muted">{param.detail || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted small">这个算子没有参数，直接调用即可。</p>
                )}
                <p className="muted small">函数签名：<code>{signature(activeOp)}</code></p>
              </div>
            ) : (
              <div className="lab-guide-block">
                <span className="lab-guide-title">用法</span>
                <p className="muted small">点左边任意算子，这里会列出它的参数与签名。</p>
              </div>
            )}

            <div className="lab-guide-block">
              <span className="lab-guide-title">写法提示</span>
              <ul className="plain">
                {NOTES.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
            </div>
          </div>

          <div className="lab-examples">
            {EXAMPLES.map((item) => (
              <button key={item.label} className="link-btn" onClick={() => setExpr(item.expr)}>
                {item.label}
              </button>
            ))}
          </div>

          <div className="lab-save">
            <input placeholder="编号（如 out_night_share）" value={saveCode} onChange={(e) => setSaveCode(e.target.value)} />
            <input placeholder="名称（如 夜间出账占比）" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            <input placeholder="单位（可空）" value={saveUnit} onChange={(e) => setSaveUnit(e.target.value)} />
            <Button
              onClick={() => {
                saveCustom({ code: saveCode, name: saveName, expr, unit: saveUnit })
                  .then(() => {
                    setSaveNote('已保存：' + saveCode + '（新版本会顶替旧版本，旧版本保留在历史里）');
                    setSaveCode('');
                    setSaveName('');
                    setSaveUnit('');
                    reloadCustom();
                  })
                  .catch((err) => setSaveNote(getErrorMessage(err, 'banker')));
              }}
            >
              保存为特征
            </Button>
          </div>
          {saveNote ? <p className="muted small">{saveNote}</p> : null}

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

function signature(op: LabOperator): string {
  if (!op.params.length) return op.key + '()';
  const inner = op.params
    .map((param) => {
      if (param.type === 'str') return param.name + "='…'";
      if (param.default === null || param.default === undefined) return param.name;
      return param.name + '=' + String(param.default);
    })
    .join(', ');
  return op.key + '(' + inner + ')';
}

function insertOperator(prev: string, key: string) {
  return prev.trim() ? prev + ' ' + key + '()' : key + '()';
}

function formatValue(value: EvaluateResult['value']) {
  if (value === null) return '空值';
  if (Array.isArray(value)) return '[' + value.map((item) => item ?? '空').join(', ') + ']';
  return String(value);
}
