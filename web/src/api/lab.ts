import { request } from './client';

/** 特征 Lab 的接口在独立服务上（8020），由 dev 代理按路径前缀分流。 */

export type LabOperator = {
  key: string;
  family: string;
  kind: string;
  unit: string;
  detail: string;
  params: { name: string; type: string; default: unknown; detail: string }[];
};

export type LabFeature = {
  code: string;
  name: string;
  unit: string;
  form: string;
  body: unknown;
  version?: string;
};

export type LabSample = { name: string; group: string };

export type EvaluateResult = {
  value: string | number | boolean | null | (string | null)[];
  type: string;
  notes: string[];
  preview: (string | null)[] | null;
  rows: number;
};

export function listOperators(): Promise<{ items: LabOperator[] }> {
  return request<{ items: LabOperator[] }>('/lab/operators');
}

export function listFeatures(): Promise<{ items: LabFeature[] }> {
  return request<{ items: LabFeature[] }>('/lab/features');
}

export function listSamples(): Promise<{ items: LabSample[] }> {
  return request<{ items: LabSample[] }>('/lab/samples');
}

export function evaluate(sample: string, expr: string): Promise<EvaluateResult> {
  return request<EvaluateResult>('/lab/evaluate', { body: { sample, expr }, timeoutMs: 60000 });
}

export type CustomFeature = {
  code: string;
  name: string;
  expr: string;
  unit: string;
  version: number;
  description: string;
  created_at: string;
};

export function listCustom(): Promise<{ items: CustomFeature[] }> {
  return request<{ items: CustomFeature[] }>('/lab/custom');
}

export function saveCustom(payload: { code: string; name: string; expr: string; unit?: string; description?: string }): Promise<CustomFeature> {
  return request<CustomFeature>('/lab/custom', { body: payload });
}

export function deleteCustom(code: string): Promise<{ code: string; deleted: boolean }> {
  return request<{ code: string; deleted: boolean }>('/lab/custom/' + code, { method: 'DELETE' });
}

export function evaluateCode(sample: string, code: string): Promise<EvaluateResult> {
  return request<EvaluateResult>('/lab/evaluate', { body: { sample, code }, timeoutMs: 60000 });
}
