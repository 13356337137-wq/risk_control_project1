import { useEffect, useMemo, useState } from 'react';
import { getMetricDefinitions, type MetricDef } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

/** 指标口径：口径是业务资产，必须能查到「这一项算什么、缺什么就算不出来」。 */
export default function MetricDefsPage() {
  const [items, setItems] = useState<MetricDef[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [group, setGroup] = useState('');

  useEffect(() => {
    getMetricDefinitions()
      .then((data) => {
        setItems(data.items);
        setVersion(data.metric_set_version);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, []);

  const groups = useMemo(() => Array.from(new Set(items.map((item) => item.group))), [items]);
  const shown = group ? items.filter((item) => item.group === group) : items;

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
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">全部分区</option>
            {groups.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}

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
    </div>
  );
}
