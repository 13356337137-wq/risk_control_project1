import { useState } from 'react';
import { AnnotatePage } from './pages/Annotate';
import { VerifyView } from './components/VerifyView';
import { MetricsView } from './components/MetricsView';

type Tab = 'annotate' | 'verify' | 'metrics' | 'list';

export default function App() {
  const [tab, setTab] = useState<Tab>('annotate');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'annotate', label: '模板标注' },
    { key: 'verify', label: '真伪判定' },
    { key: 'metrics', label: '指标报告' },
    { key: 'list', label: '模板列表' },
  ];

  return (
    <div className="app">
      <div className="topbar">
        <h1>智能风控 · 银行侧</h1>
        <div className="tabs">
          {tabs.map(t => (
            <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === 'annotate' && <AnnotatePage />}
      {tab === 'verify' && <div className="result-wrap"><VerifyView /></div>}
      {tab === 'metrics' && <div className="result-wrap"><MetricsView /></div>}
      {tab === 'list' && <TemplateList />}
    </div>
  );
}

function TemplateList() {
  return (
    <div className="stage-wrap">
      <div className="empty">
        模板列表页尚未实现。<br />
        需要后端 <span className="mono">GET /templates</span>、<span className="mono">POST /templates</span>、
        <span className="mono">/publish</span> 就绪后接入。<br />
        当前可用：模板标注（标注并导出 field_map）、真伪判定（示例）、指标报告（示例）。
      </div>
    </div>
  );
}
