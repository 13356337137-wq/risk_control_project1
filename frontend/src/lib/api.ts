export interface CreateTaskResult { task_id: number; biz_no: string; status: string; carrier: string; txn_count: number }

export async function createTask(form: FormData): Promise<CreateTaskResult> {
  const res = await fetch('/api/v1/tasks', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const message = typeof detail === 'string' ? detail : detail?.message || `提交失败（${res.status}）`;
    const code = typeof detail === 'object' ? detail?.code : undefined;
    throw Object.assign(new Error(message), { code });
  }
  return data as CreateTaskResult;
}

export interface TaskStatus { id: number; biz_no: string; status: string; carrier: string | null }

export async function getTask(taskId: number): Promise<TaskStatus> {
  const res = await fetch(`/api/v1/tasks/${taskId}`);
  if (!res.ok) throw new Error(`查询状态失败（${res.status}）`);
  return (await res.json()) as TaskStatus;
}

