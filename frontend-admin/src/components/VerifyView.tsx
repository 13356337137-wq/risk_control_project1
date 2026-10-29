import { verifyDemo, type Layer } from '../lib/demo';

const LAYER_NAMES: Record<string, string> = {
  carrier: '载体层',
  content: '内容层',
  ledger: '账务层',
  external: '外部层',
};

export function VerifyView() {
  const d = verifyDemo;
  return (
    <div className="result">
      <div className="result-head">
        <h2>流水真伪判定</h2>
        <span className="badge">任务 {d.task_id}</span>
        <span className="badge warn">载体 {d.carrier}</span>
        <span className="badge muted">示例数据</span>
      </div>

      <div className={`verdict-card ${d.verdict === '未发现异常' ? 'ok' : 'bad'}`}>
        <div className="verdict-title">{d.verdict}</div>
        <div className="verdict-reason">{d.verdict_reason}</div>
      </div>

      {d.limitations.length > 0 && (
        <div className="limitation">
          <b>核验受限</b>
          <ul>{d.limitations.map(x => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      <div className="layer-grid">
        {(Object.keys(LAYER_NAMES) as Array<keyof typeof d.layers>).map(key => {
          const layer = d.layers[key] as Layer;
          return (
            <div className="layer" key={String(key)}>
              <div className="layer-head">
                <b>{LAYER_NAMES[String(key)]}</b>
                <span className={layer.verdict === '通过' ? 'tag ok' : 'tag warn'}>{layer.verdict}</span>
              </div>
              <table className="mini">
                <thead><tr><th>项</th><th>结果</th><th>说明</th></tr></thead>
                <tbody>
                  {layer.items.map(it => (
                    <tr key={it.code}>
                      <td>{it.name}</td>
                      <td>{it.result}</td>
                      <td className="muted">{it.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <h3>证据（可回到原页）</h3>
      <table className="mini">
        <thead><tr><th>交易</th><th>规则</th><th>页码</th><th>坐标</th><th>说明</th></tr></thead>
        <tbody>
          {d.evidence.map(e => (
            <tr key={`${e.txn_id}-${e.rule_code}`}>
              <td className="mono">{e.txn_id}</td>
              <td className="mono">{e.rule_code}</td>
              <td>{e.page_no}</td>
              <td className="mono">{e.x.toFixed(4)}, {e.y.toFixed(4)}</td>
              <td className="muted">{e.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{d.note}</p>
    </div>
  );
}
