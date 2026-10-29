import { useState } from 'react';
import { AnnotatePage } from './pages/Annotate';

export default function App() {
  const [tab, setTab] = useState<'annotate' | 'list'>('annotate');

  return (
    <div className="app">
      <div className="topbar">
        <h1>智能风控 · 银行侧</h1>
        <div className="tabs">
          <button className={tab === 'annotate' ? 'active' : ''} onClick={() => setTab('annotate')}>模板标注</button>
          <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>模板列表</button>
        </div>
      </div>
      {tab === 'annotate' ? <AnnotatePage /> : <TemplateList />}
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
        当前可用的是「模板标注」页：载入样例 → 框选 → 指定字段 → 导出 field_map。
      </div>
    </div>
  );
}
