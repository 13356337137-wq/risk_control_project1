import { request } from './client';

/** 银行侧接口直出对象（没有 {code,data} 信封），与借款侧不同——合并前端时这一点最容易踩。 */

export type TaskSummary = {
  id: number;
  biz_no: string;
  status: string;
  carrier: string | null;
  created_at: string | null;
  bank_name: string | null;
  bank_code: string | null;
  period_start: string | null;
  period_end: string | null;
  verdict: string | null;
  authenticity: { level: string; label: string };
  parse: { level: string; label: string; txn_count: number; metrics_valued: number; metrics_total: number };
  risk: { level: string; label: string; count: number };
  source: { level: string; label: string };
  income: string | null;
  monthly_income: string | null;
  dti: string | null;
  materials: number;
  limitations: number;
  report_version: number | null;
};

export type TaskList = { items: TaskSummary[]; total: number; facets: Record<string, Record<string, number>> };

export type TaskFilters = { q?: string; authenticity?: string; limit?: number; offset?: number };

export function listTasks(filters: TaskFilters = {}): Promise<TaskList> {
  const params = new URLSearchParams();
  params.set('limit', String(filters.limit ?? 20));
  if (filters.offset) params.set('offset', String(filters.offset));
  if (filters.q) params.set('q', filters.q);
  if (filters.authenticity) params.set('authenticity', filters.authenticity);
  return request<TaskList>('/tasks?' + params.toString());
}

export type ReportPayload = {
  verdict: string;
  verdict_reason: string;
  carrier?: string;
  layers?: { layer: string; status: string; detail: string }[];
  metrics?: { code: string; name: string; value: string | null; unit: string; note: string }[];
  scores?: { overall?: number; grade_label?: string; partitions?: { key: string; label: string; score: number }[] };
  limitations?: string[];
  trust?: { score?: number; level?: string; label?: string; layers?: { layer: string; label: string; score: number; weight: number }[] };
  metric_set_version?: number;
  threshold_version?: number;
  conclusions?: { code: string; message: string; level: string }[];
};

export function getReport(taskId: number): Promise<ReportPayload> {
  return request<ReportPayload>('/reports/' + taskId);
}

export type AuditRow = {
  id: number;
  actor_id: number | null;
  action: string;
  object_type: string | null;
  object_id: number | null;
  detail: string | null;
  created_at: string | null;
};

export function listAudit(params: { limit?: number; offset?: number } = {}): Promise<{ items: AuditRow[]; total: number }> {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit ?? 50));
  if (params.offset) query.set('offset', String(params.offset));
  return request<{ items: AuditRow[]; total: number }>('/audit?' + query.toString());
}

export type AppUser = {
  id: number;
  username: string;
  role: string;
  display_name: string | null;
  is_admin: boolean;
  status: string;
  created_at: string | null;
  last_login_at: string | null;
};

export function listUsers(): Promise<{ items: AppUser[] }> {
  return request<{ items: AppUser[] }>('/auth/users');
}
