import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCustomMetric,
  deleteCustomMetric,
  getMetricDefinitions,
  listCustomMetrics,
  type CustomMetricItem,
  type MetricDef,
} from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { getUser } from '../../auth/store';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

/** 指标口径：口径是业务资产，必须能查到「这一项算什么、缺什么就算不出来」。 */
export default function MetricDefsPage() {
  const isAdmin = Boolean(getUser()?.is_admin);
  const [items, setItems] = useState<MetricDef[]>([]);
  const [customs, setCustoms] = useState<CustomMetricItem[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [group, setGroup] = useState('');
  const [keyword, setKeyword] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newFormula, setNewFormula] = useState('');

  const loadCustoms = useCallback(() => {
    listCustomMetrics()
      .then((res) => setCustoms(res.items ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getMetricDefinitions()
      .then((data) => {
        setItems(data.items);
        setVersion(data.metric_set_version);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
    loadCustoms();
  }, [loadCustoms]);

  const groups = useMemo(() => Array.from(new Set(items.map((item) => item.group))), [items]);
  const shown = items.filter((item) => {
    if (group && item.group !== group) return false;
    if (!keyword.trim()) return true;
    const q = keyword.trim().toLowerCase();
    return item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q) || (item.formula || '').toLowerCase().includes(q);
  });

  async function handleAddCustom() {
    if (!newCode.trim() || !newName.trim()) {
      setError('请填写自定义指标代号与名称');
      return;
    }
    setError('');
    try {
      await createCustomMetric({ code: newCode.trim(), name: newName.trim(), formula: newFormula.trim() || undefined });
      setNewCode('');
      setNewName('');
      setNewFormula('');
      setNotice('已新增自定义指标。');
      loadCustoms();
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    }
  }

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>指标口径</h1>
          <p className="sub">
            共 {items.length} 项 · 指标集版本 {version ?? '—'}。口径只增不改，历史报告按当时版本解释。
          </p>
        </div>
        <div className="filters">
          <input
            className="search"
            placeholder="搜索代号 / 指标名 / 口径"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">全部分区</option>
            {groups.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}

      <table className="grid compact">
        <thead>
          <tr><th>代号</th><th>指标</th><th>单位</th><th>口径</th><th>输入</th></tr>
        </thead>
        <tbody>
          {shown.map((item) => (
            <tr key={item.code}>
              <td>{item.code}</td>
              <td>{item.name}</td>
              <td className="muted small">{item.unit}</td>
              <td className="small">{item.formula}</td>
              <td className="small muted">{item.inputs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section style={{ marginTop: 22 }}>
        <h2>自定义指标（{customs.length}）</h2>
        {isAdmin ? (
          <div className="filters" style={{ marginBottom: 10 }}>
            <input placeholder="代号，如 night_out" value={newCode} onChange={(e) => setNewCode(e.target.value)} />
            <input placeholder="中文名称" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input placeholder="口径说明（可选）" value={newFormula} onChange={(e) => setNewFormula(e.target.value)} />
            <Button size="sm" onClick={() => void handleAddCustom()}>新增指标</Button>
          </div>
        ) : null}
        {customs.length ? (
          <table className="grid compact">
            <thead><tr><th>代号</th><th>名称</th><th>口径</th>{isAdmin ? <th>操作</th> : null}</tr></thead>
            <tbody>
              {customs.map((c) => (
                <tr key={c.id}>
                  <td className="mono small">{c.code}</td>
                  <td>{c.name}</td>
                  <td className="small muted">{c.formula || '—'}</td>
                  {isAdmin ? (
                    <td>
                      <button type="button" className="link-btn danger" onClick={() => void deleteCustomMetric(c.id).then(loadCustoms)}>
                        删除
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small">暂未登记自定义指标。</p>}
      </section>
    </div>
  );
}
