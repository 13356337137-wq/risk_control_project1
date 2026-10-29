import type { Tool } from '../lib/types';

interface Props {
  tool: Tool;
  onTool: (t: Tool) => void;
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  zoom: number;
  onZoom: (z: number) => void;
  onFile: (f: File) => void;
  onDemo: () => void;
  onSave: () => void;
  onReset: () => void;
  blocking: number;
}

export function Toolbar(p: Props) {
  return (
    <div className="toolbar">
      <div className="group">
        <label className="btn" style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          载入样例
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) p.onFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <button className="btn" onClick={p.onDemo}>示例页</button>
      </div>

      <div className="group">
        <button className={`btn ${p.tool === 'meta' ? 'tool-active' : ''}`} onClick={() => p.onTool('meta')}>
          画字段框
        </button>
        <button className={`btn ${p.tool === 'table' ? 'tool-active' : ''}`} onClick={() => p.onTool('table')}>
          画表格区
        </button>
        <button className={`btn ${p.tool === 'column' ? 'tool-active' : ''}`} onClick={() => p.onTool('column')}>
          画列边界
        </button>
      </div>

      <div className="group">
        <button className="btn" disabled={p.page <= 1} onClick={() => p.onPage(p.page - 1)}>上一页</button>
        <span className="muted">{p.pageCount > 0 ? `${p.page} / ${p.pageCount}` : '— / —'}</span>
        <button className="btn" disabled={p.page >= p.pageCount} onClick={() => p.onPage(p.page + 1)}>下一页</button>
      </div>

      <div className="group">
        {[0.75, 1, 1.35].map(z => (
          <button key={z} className={`btn ${p.zoom === z ? 'tool-active' : ''}`} onClick={() => p.onZoom(z)}>
            {Math.round(z * 100)}%
          </button>
        ))}
      </div>

      <div className="group">
        <button className="btn primary" onClick={p.onSave}>
          {p.blocking > 0 ? `保存（${p.blocking} 项待修）` : '保存并导出'}
        </button>
        <button className="btn danger" onClick={p.onReset}>清空</button>
      </div>
    </div>
  );
}
