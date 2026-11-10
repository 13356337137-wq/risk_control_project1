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

export type MetricDef = {
  code: string;
  name: string;
  unit: string;
  group: string;
  formula: string;
  inputs: string;
  viz: string;
};

export function getMetricDefinitions(): Promise<{ metric_set_version: number; items: MetricDef[] }> {
  return request<{ metric_set_version: number; items: MetricDef[] }>('/metric-definitions');
}

export type VerificationDef = { code: string; layer: string; method: string };

export function getVerificationDefinitions(): Promise<{ items: VerificationDef[] }> {
  return request<{ items: VerificationDef[] }>('/verification-definitions');
}

export type TemplateRow = {
  id: number;
  bank_code: string;
  version: number;
  status: string;
  field_map: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
};

export function listTemplates(includeDeleted = false): Promise<TemplateRow[]> {
  return request<TemplateRow[]>('/templates' + (includeDeleted ? '?include_deleted=true' : ''));
}

export type TemplateDetail = {
  id: number;
  bank_code: string;
  version: number;
  status: string;
  field_map: Record<string, unknown>;
  layout: unknown | null;
};

export function getTemplate(id: number): Promise<TemplateDetail> {
  return request<TemplateDetail>('/templates/' + id);
}

export type TemplateStats = {
  template_id: number;
  bank_code: string;
  version: number;
  status: string;
  tasks_total: number;
  tasks_done: number;
  tasks_failed: number;
  success_rate: number | null;
  avg_txn_count: number | null;
  zero_txn_tasks: number;
};

export function getTemplateStats(id: number): Promise<TemplateStats> {
  return request<TemplateStats>('/templates/' + id + '/stats');
}

export type TemplateLayoutBox = { field: string; column: string; page: number; x0: number; y0: number; x1: number; y1: number };
export type TemplateLayout = {
  template_id: number;
  has_sample: boolean;
  layout: { pages?: Record<string, { width: number; height: number }>; page_count?: number; boxes?: TemplateLayoutBox[] } | null;
  field_map: Record<string, unknown> | null;
  header_columns: string[] | null;
};

export function getTemplateLayout(id: number): Promise<TemplateLayout> {
  return request<TemplateLayout>('/templates/' + id + '/layout');
}

export function publishTemplate(id: number): Promise<{ status: string }> {
  return request<{ status: string }>('/templates/' + id + '/publish', { method: 'POST' });
}

export function disableTemplate(id: number): Promise<{ status: string }> {
  return request<{ status: string }>('/templates/' + id + '/disable', { method: 'POST' });
}

export function duplicateTemplate(id: number): Promise<{ id: number; version: number }> {
  return request<{ id: number; version: number }>('/templates/' + id + '/duplicate', { method: 'POST' });
}

export function deleteTemplate(id: number): Promise<{ id: number; removed: boolean }> {
  return request<{ id: number; removed: boolean }>('/templates/' + id, { method: 'DELETE' });
}

export function restoreTemplate(id: number): Promise<{ id: number; restored: boolean }> {
  return request<{ id: number; restored: boolean }>('/templates/' + id + '/restore', { method: 'POST' });
}

export type ProbeSuggestion = { field: string; column: string; x: number; y: number };
export type ProbeResult = {
  bank_name: string | null;
  bank_code: string | null;
  rotation: number;
  page_size: { width: number; height: number };
  header_found: boolean;
  headers: { text: string; x: number; y: number }[];
  suggestions?: ProbeSuggestion[];
  table_area?: { x: number; y: number; w: number; h: number; header_y?: number } | null;
};

export function probeTemplate(file: File, password?: string): Promise<ProbeResult> {
  const form = new FormData();
  form.append('file', file);
  if (password) form.append('password', password);
  return request<ProbeResult>('/templates/probe', { form, timeoutMs: 180000 });
}

export function createTemplate(payload: { bank_code: string; field_map: Record<string, unknown> }): Promise<{ id: number; status: string }> {
  return request<{ id: number; status: string }>('/templates', { body: payload });
}

export function updateTemplate(
  id: number,
  patch: { field_map?: Record<string, unknown>; layout?: unknown },
): Promise<{ id: number; version: number }> {
  return request<{ id: number; version: number }>('/templates/' + id, { method: 'PUT', body: patch });
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
