import { useEffect, useState } from 'react';
import { getEntities, type EntitiesPayload } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

/**
 * 客户与账户。
 *
 * 同一客户在多家银行、多个账户下的流水，要先认出「是同一个人」才能合并看。
 * 这一版只做只读呈现：账户清单、已识别的客户、冲突待裁决项。
 * 合并动作（8 种口径）还没迁，页面里明说。
 */
export default function EntitiesPage() {
  const [data, setData] = useState<EntitiesPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getEntities()
      .then(setData)
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, []);

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>客户与账户</h1>
          <p className="sub">账户按账号+户名归并；多账户客户可合并看全景。合并动作仍在旧版，本页只读。</p>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}

      {data ? (
        <section className="score-row">
          <div className="score"><span className="score-value">{data.summary.accounts}</span><span className="muted small">账户</span></div>
          <div className="score"><span className="score-value">{data.summary.subjects}</span><span className="muted small">客户</span></div>
          <div className="score"><span className="score-value">{data.summary.multi_account_subjects}</span><span className="muted small">多账户客户</span></div>
          <div className="score"><span className="score-value">{data.summary.conflicts}</span><span className="muted small">待裁决冲突</span></div>
        </section>
      ) : null}

      <h2>账户</h2>
      <table className="grid compact">
        <thead>
          <tr><th>银行</th><th>账号</th><th>户名</th><th>任务</th></tr>
        </thead>
        <tbody>
          {(data?.accounts ?? []).map((account) => (
            <tr key={account.key}>
              <td>{account.bank_name}</td>
              <td className="small muted">{account.account_masked}</td>
              <td>{Object.keys(account.holders ?? {}).join('、') || '—'}</td>
              <td className="small muted">{(account.tasks ?? []).slice(0, 6).join('、')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data?.conflicts?.length ? (
        <>
          <h2>待裁决冲突（{data.conflicts.length}）</h2>
          <ul className="plain">
            {data.conflicts.slice(0, 8).map((item, index) => (
              <li key={index}>
                {String(item.subject ?? '未知客户')} · {String(item.reason ?? '同名/同账号冲突')}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
