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
  metrics?: { code: string; name: string; value: string | null; unit: string; note: string; caliber_version?: number }[];
  scores?: {
    overall?: number;
    grade?: string;
    grade_label?: string;
    method?: string;
    domains?: {
      key: string;
      name: string;
      desc: string;
      score: number;
      weight: number;
      hits: string[];
      detail?: string;
      missing: number;
      metric_total: number;
      metric_valued: number;
    }[];
  };
  trend?: { month: string; income: string; expense: string }[];
  limitations?: string[];
  trust?: {
    score?: number;
    level?: string;
    label?: string;
    note?: string;
    layers?: { layer: string; label: string; score: number; weight: number; status: string; note?: string }[];
  };
  metric_set_version?: number;
  threshold_version?: number;
  conclusions?: { code: string; message: string; level: string }[];
  scores_detail?: unknown;
  evidence?: {
    rule_code?: string;
    page_no?: number;
    txn_id?: number;
    x?: number;
    y?: number;
  }[];
  materials?: { role: string; pages: number; sha256?: string | null; file_id?: number }[];
  self_check?: Record<string, unknown> | null;
  verification?: unknown;
  custom_field_stats?: unknown;
  version?: number;
};

export function getReport(taskId: number): Promise<ReportPayload> {
  return request<ReportPayload>('/reports/' + taskId);
}

export type TxnRow = {
  id: number;
  txn_date: string | null;
  direction: string | null;
  amount: string | null;
  balance: string | null;
  summary: string | null;
  counterparty_name?: string | null;
  page_no?: number | null;
  confidence?: string | null;
};

export function getTransactions(taskId: number): Promise<TxnRow[]> {
  return request<TxnRow[]>('/tasks/' + taskId + '/transactions?limit=2000');
}

/** 取任务原件（PDF 原始字节）；报告里的「原始文件」就是它。 */
export async function getTaskFile(taskId: number): Promise<Blob> {
  const token = localStorage.getItem('bs_token');
  const response = await fetch('/api/v1/tasks/' + taskId + '/file', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  if (!response.ok) throw new Error('取不到原件（' + response.status + '）');
  return await response.blob();
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
  required_fields?: string[] | null;
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

export type TemplatePreview = {
  template_id: number;
  txn_count: number;
  page_count: number;
  pages: { page_no: number; rows: number; header_found: boolean; columns: number }[];
  warnings: string[];
  rows: {
    txn_date: string | null;
    summary: string | null;
    direction: string | null;
    amount: string | null;
    balance: string | null;
    page_no: number;
  }[];
  required_fields: string[];
  missing_columns: string[];
  empty_columns: string[];
  present_columns: string[];
};

export function previewTemplate(id: number, file: Blob, password?: string): Promise<TemplatePreview> {
  const form = new FormData();
  form.append('file', file, 'sample.pdf');
  if (password) form.append('password', password);
  return request<TemplatePreview>('/templates/' + id + '/preview', { form, timeoutMs: 240000 });
}

export function updateTemplateRequired(id: number, required: string[]): Promise<{ id: number; version: number }> {
  return request<{ id: number; version: number }>('/templates/' + id, {
    method: 'PUT',
    body: { required_fields: required },
  });
}

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

export type ThresholdDef = {
  key: string;
  label: string;
  group: string;
  kind: string;
  unit: string;
  default: string | number | null;
  minimum: string | number | null;
  maximum: string | number | null;
  desc: string;
  impacts: string[];
  calibrated: boolean;
};

export type ThresholdPayload = {
  version: number;
  values: Record<string, string | number | null>;
  defs: ThresholdDef[];
};

export function getThresholds(): Promise<ThresholdPayload> {
  return request<ThresholdPayload>('/thresholds');
}

export function saveThresholds(
  values: Record<string, string | number | null>,
  note?: string,
): Promise<{ version: number; saved_version: number; values: Record<string, string | number | null> }> {
  return request('/thresholds', { method: 'PUT', body: { values, note } });
}

export type EntityAccount = {
  key: string;
  bank_name: string;
  bank_code: string;
  account_masked: string;
  holders: Record<string, number>;
  tasks: number[];
};

export type EntitySubject = {
  subject: string;
  accounts?: string[];
  task_count?: number;
  [key: string]: unknown;
};

export type EntitiesPayload = {
  accounts: EntityAccount[];
  subjects: EntitySubject[];
  conflicts: { subject?: string; reason?: string; options?: unknown[] }[];
  summary: { accounts: number; subjects: number; multi_account_subjects: number; conflicts: number };
};

export function getEntities(): Promise<EntitiesPayload> {
  return request<EntitiesPayload>('/entities');
}

export type OcrRouting = {
  enabled: boolean;
  min_images: number;
  workers: number;
  model: string;
  endpoint: string;
  has_api_key: boolean;
  credential_ready: boolean;
};

export function getOcrRouting(): Promise<OcrRouting> {
  return request<OcrRouting>('/ocr-routing');
}

export function saveOcrRouting(patch: Partial<OcrRouting> & { api_key?: string }): Promise<OcrRouting> {
  return request<OcrRouting>('/ocr-routing', { method: 'PUT', body: patch });
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
