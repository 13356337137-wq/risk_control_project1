import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listTasks, type TaskList, type TaskSummary } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

const VERDICT_TONE: Record<string, string> = {
  未发现异常: 'ok',
  存在不一致: 'bad',
  来源可疑: 'bad',
  余额可疑: 'warn',
  无法判定: 'muted',
};

function Badge({ text, tone }: { text: string; tone: string }) {
  return <span className={'badge badge-' + tone}>{text}</span>;
}

export default function TaskListPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<TaskList | null>(null);
  const [query, setQuery] = useState('');
  const [authenticity, setAuthenticity] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const PAGE = 20;
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listTasks({ q: query || undefined, authenticity: authenticity || undefined, limit: PAGE, offset })
      .then((result) => {
        if (alive) {
          setData(result);
          setError('');
        }
      })
      .catch((err) => alive && setError(getErrorMessage(err, 'banker')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, authenticity, offset]);

  const facets = data?.facets?.authenticity ?? {};

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>受理与报告</h1>
          <p className="sub">按真实性筛，点开看报告。共 {data?.total ?? 0} 份。</p>
        </div>
        <div className="filters">
          <input
            className="search"
            placeholder="搜索业务号 / 户名"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
          />
          <select
            value={authenticity}
            onChange={(event) => {
              setAuthenticity(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">全部真实性</option>
            {Object.entries(facets).map(([key, count]) => (
              <option key={key} value={key}>
                {key}（{count}）
              </option>
            ))}
          </select>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}
      {loading && !data ? <p className="muted">加载中…</p> : null}

      {data ? (
        <table className="grid">
          <thead>
            <tr>
              <th>业务号</th>
              <th>真实性</th>
              <th>解析</th>
              <th>风险线索</th>
              <th>月均收入</th>
              <th>账期</th>
              <th>报告</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((task: TaskSummary) => (
              <tr key={task.id} className="clickable" onClick={() => navigate('/bank/report/' + task.id)}>
                <td>
                  <strong>{task.biz_no}</strong>
                  <div className="muted small">
                    #{task.id} · {task.carrier === 'electronic' ? '电子件' : task.carrier === 'image' ? '影像件' : '截图'}
                  </div>
                </td>
                <td>
                  <Badge text={task.verdict ?? '待复核'} tone={VERDICT_TONE[task.verdict ?? ''] ?? 'muted'} />
                  <div className="muted small">{task.authenticity?.label}</div>
                </td>
                <td>
                  <div>{task.parse?.label}</div>
                  <div className="muted small">
                    {task.parse?.txn_count ?? 0} 笔 · 指标 {task.parse?.metrics_valued ?? 0}/{task.parse?.metrics_total ?? 40}
                  </div>
                </td>
                <td>
                  <div>{task.risk?.label}</div>
                  <div className="muted small">{task.risk?.count ?? 0} 条</div>
                </td>
                <td>{task.monthly_income ?? '—'}</td>
                <td className="small">
                  {task.period_start ?? '—'} ~ {task.period_end ?? '—'}
                </td>
                <td>
                  <Link className="link-btn" to={'/bank/report/' + task.id} onClick={(e) => e.stopPropagation()}>
                    打开
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {data && data.items.length === 0 ? <p className="muted">没有符合条件的流水。</p> : null}

      {data && data.total > PAGE ? (
        <div className="pager">
          <button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            上一页
          </button>
          <span className="muted small">
            第 {offset + 1}–{Math.min(offset + PAGE, data.total)} 条 / 共 {data.total} 条
          </span>
          <button
            className="btn btn-ghost"
            disabled={offset + PAGE >= data.total}
            onClick={() => setOffset(offset + PAGE)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}
