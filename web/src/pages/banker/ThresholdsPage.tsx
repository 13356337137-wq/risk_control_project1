import { useEffect, useMemo, useState } from 'react';
import { getThresholds, saveThresholds, type ThresholdDef } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { getUser } from '../../auth/store';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

/**
 * 风控参数。
 *
 * 规则：参数版本化，改一次升一版；**旧报告不重写**——报告里存的是当时的参数版本，
 * 所以这里改值只影响之后的分析。页面上把这句话写出来，避免有人以为改完历史会跟着变。
 */
export default function ThresholdsPage() {
  const isAdmin = Boolean(getUser()?.is_admin);
  const [defs, setDefs] = useState<ThresholdDef[]>([]);
  const [values, setValues] = useState<Record<string, string | number | null>>({});
  const [version, setVersion] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getThresholds()
      .then((data) => {
        setDefs(data.defs ?? []);
        setValues(data.values ?? {});
        setVersion(data.version);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, []);

  const groups = useMemo(() => Array.from(new Set(defs.map((item) => item.group))), [defs]);

  async function save() {
    setError('');
    setMessage('');
    try {
      const result = await saveThresholds(values, note || undefined);
      setVersion(result.saved_version);
      setMessage('已保存为第 ' + result.saved_version + ' 版；旧报告仍按各自版本解释。');
      setNote('');
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    }
  }

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>风控参数</h1>
          <p className="sub">
            当前第 {version ?? '—'} 版，共 {defs.length} 项。改动只影响之后的分析，历史报告不重写。
          </p>
        </div>
        {isAdmin ? <Button onClick={() => void save()}>保存为新版本</Button> : <span className="muted small">只读（需管理员）</span>}
      </header>

      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      {groups.map((group) => (
        <section key={group}>
          <h2>{group}</h2>
          <table className="grid compact">
            <thead>
              <tr><th>参数</th><th>值</th><th>范围</th><th>说明</th></tr>
            </thead>
            <tbody>
              {defs.filter((item) => item.group === group).map((item) => (
                <tr key={item.key}>
                  <td>
                    {item.label}
                    <div className="muted small">{item.key}</div>
                  </td>
                  <td>
                    <input
                      className="threshold-input"
                      disabled={!isAdmin}
                      value={values[item.key] ?? ''}
                      onChange={(event) => setValues({ ...values, [item.key]: event.target.value })}
                    />
                  </td>
                  <td className="muted small">
                    {item.minimum ?? '—'} ~ {item.maximum ?? '—'} {item.unit}
                  </td>
                  <td className="small muted">{item.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {isAdmin ? (
        <div className="lab-save" style={{ marginTop: 10 }}>
          <input placeholder="改动备注（可空）" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      ) : null}
    </div>
  );
}
