import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTask, type TaskDetail } from '../../api/borrower';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

/**
 * 借款侧进度页。
 *
 * 刻意只显示「到哪一步了」：结论、指标、风险都不给借款人看，这是产品口径，
 * 不是没做完——报告只有银行侧可见。
 */
const STEPS: { key: string; label: string }[] = [
  { key: 'QUEUED', label: '已受理，等待开始' },
  { key: 'CHECKING', label: '检查文件' },
  { key: 'PARSING', label: '识别流水明细' },
  { key: 'VERIFYING', label: '核验真实性' },
  { key: 'REPORTING', label: '生成结论' },
  { key: 'DONE', label: '处理完成' },
];

const ORDER = STEPS.map((step) => step.key);

function stepIndex(status: string) {
  const index = ORDER.indexOf(status);
  if (status === 'PENDING') return -1;
  if (status === 'NEED_SUPPLEMENT') return ORDER.indexOf('PARSING');
  return index;
}

function failureText(code: string | null) {
  switch (code) {
    case 'E_FORMAT':
      return '文件格式无法识别，请重新导出 PDF 后上传。';
    case 'E_ENCRYPT':
      return '文件有打开口令，请重新上传并填写口令。';
    case 'E_NOT_STATEMENT':
      return '这份文件不像银行流水，请上传对账单或交易明细。';
    case 'E_NOLAYER':
      return '这份文件像是截图或扫描件，无法作为有效材料。';
    default:
      return '处理未完成，请联系银行工作人员。';
  }
}

export default function ProgressPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!Number.isFinite(taskId)) return;
    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const detail = await getTask(taskId);
        if (!alive) return;
        setTask(detail);
        setError('');
        if (detail.status !== 'DONE' && detail.status !== 'FAILED') {
          timer = window.setTimeout(tick, 2000);
        }
      } catch (err) {
        if (!alive) return;
        setError(getErrorMessage(err, 'borrower'));
        timer = window.setTimeout(tick, 4000);
      }
    };

    void tick();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [taskId]);

  const status = task?.status ?? 'PENDING';
  const current = stepIndex(status);
  const failed = status === 'FAILED';

  return (
    <div className="panel">
      <h1>处理进度</h1>
      <p className="sub">
        业务号 {task?.biz_no ?? '—'} · 提交时间 {task?.created_at ? new Date(task.created_at).toLocaleString() : '—'}
      </p>

      {error ? <Notice>{error}</Notice> : null}

      {failed ? (
        <Notice>{failureText(task?.failure_code ?? null)}</Notice>
      ) : (
        <ol className="timeline">
          {STEPS.map((step, index) => {
            const state = index < current ? 'done' : index === current ? 'active' : 'todo';
            return (
              <li key={step.key} className={'timeline-item ' + state}>
                <span className="dot" />
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {status === 'NEED_SUPPLEMENT' ? (
        <Notice tone="info">流水里有内容没读全，银行会联系你补充材料。</Notice>
      ) : null}

      <div className="actions">
        <Link className="btn btn-ghost" to="/app/upload">
          再传一份
        </Link>
      </div>

      <p className="muted small">本页只显示处理进度；结论与指标由银行侧查看。</p>
    </div>
  );
}
