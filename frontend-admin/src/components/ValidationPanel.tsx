import type { Issue } from '../lib/types';

interface Props {
  issues: Issue[];
  onLocate: (issue: Issue) => void;
}

export function ValidationPanel({ issues, onLocate }: Props) {
  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');

  return (
    <div className="issues">
      <div className="issues-head">
        解析与标注检查
        <span className="muted">错误 {errors.length} · 警告 {warnings.length}</span>
      </div>
      {issues.length === 0 && (
        <div className="empty">暂无问题。标注完成后点「保存并导出」。</div>
      )}
      {issues.map((issue, idx) => (
        <button
          key={`${issue.code}-${idx}`}
          className={`issue ${issue.level}`}
          onClick={() => onLocate(issue)}
        >
          <span className="code">[{issue.code}]</span>
          {issue.message}
        </button>
      ))}
    </div>
  );
}
