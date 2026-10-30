import { useState } from 'react';
import { AnnotatePage } from './pages/Annotate';
import { TaskList } from './components/TaskList';
import { TemplateAdmin } from './components/TemplateAdmin';

type Tab = 'annotate' | 'tasks' | 'templates';

export default function App() {
  const [tab, setTab] = useState<Tab>('tasks');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'tasks', label: '任务与报告' },
    { key: 'annotate', label: '模板标注' },
    { key: 'templates', label: '模板管理' },
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
      {tab === 'tasks' && <TaskList />}
      {tab === 'annotate' && <AnnotatePage />}
      {tab === 'templates' && <TemplateAdmin />}
    </div>
  );
}

