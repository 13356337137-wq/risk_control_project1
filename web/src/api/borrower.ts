import { request } from './client';

/** 借款侧只有三个动作：提交、合并提交、查进度。 */

export type CreateTaskResult = {
  task_id: number;
  biz_no: string;
  status: string;
};

export type TaskDetail = {
  id: number;
  biz_no: string;
  status: string;
  carrier: string | null;
  period_start: string | null;
  period_end: string | null;
  failure_code: string | null;
  created_at: string | null;
};

function form(fields: Record<string, string | undefined>, files: File[], fieldName: string): FormData {
  const data = new FormData();
  files.forEach((file) => data.append(fieldName, file));
  Object.entries(fields).forEach(([key, value]) => {
    if (value) data.append(key, value);
  });
  return data;
}

export function createTask(fields: Record<string, string | undefined>, file: File): Promise<CreateTaskResult> {
  return request<CreateTaskResult>('/tasks', { form: form(fields, [file], 'file'), timeoutMs: 180000 });
}

export function composeTask(fields: Record<string, string | undefined>, files: File[]): Promise<CreateTaskResult> {
  return request<CreateTaskResult>('/tasks/compose', { form: form(fields, files, 'files'), timeoutMs: 300000 });
}

export function getTask(taskId: number): Promise<TaskDetail> {
  return request<TaskDetail>('/tasks/' + taskId);
}
