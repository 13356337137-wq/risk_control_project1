import type { FieldMapV1, Issue, Rect } from './types';
import { CODE_PATTERN, REQUIRED_CODES, FIELD_DICT } from './fields';

export const DRAFT_KEY = 'bs-admin-template-draft-v1';
const EPS = 0.002;

export const round4 = (n: number): number => Math.round(n * 10000) / 10000;
export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export function uid(prefix = 'b'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmpty(bankCode = ''): FieldMapV1 {
  return {
    schema_version: 1,
    bank_code: bankCode,
    page_size: { w: 0, h: 0 },
    match_rule: { bank_name_keywords: [], header_fingerprint: [] },
    meta_boxes: [],
    tables: [],
    custom_fields: [],
    meta: { created_at: new Date().toISOString() },
  };
}

/** 由两点生成规范矩形：允许反方向拖拽，结果恒为正宽高并裁剪到页面内。 */
export function rectFromPoints(
  ax: number, ay: number, bx: number, by: number,
): Rect {
  const x1 = clamp01(Math.min(ax, bx));
  const y1 = clamp01(Math.min(ay, by));
  const x2 = clamp01(Math.max(ax, bx));
  const y2 = clamp01(Math.max(ay, by));
  return { x: round4(x1), y: round4(y1), w: round4(x2 - x1), h: round4(y2 - y1) };
}

export function isUsableRect(r: Rect): boolean {
  return r.w >= EPS && r.h >= EPS;
}

export function insideRect(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - 1e-6 &&
    inner.y >= outer.y - 1e-6 &&
    inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
    inner.y + inner.h <= outer.y + outer.h + 1e-6
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/** 校验规则见 algorithm/template-spec.md 第七节；T010 为本实现补充（框未指定字段）。 */
export function validate(map: FieldMapV1, pageCount: number): Issue[] {
  const issues: Issue[] = [];
  const core = new Set(FIELD_DICT.map(f => f.code));

  if (!map.bank_code.trim()) {
    issues.push({ code: 'T001', level: 'error', message: '请先选择版式所属银行' });
  }
  if (map.meta_boxes.length === 0 && map.tables.length === 0) {
    issues.push({ code: 'T002', level: 'error', message: '至少标注一个字段框或一个表格区' });
  }

  const assigned = new Set<string>();
  for (const box of map.meta_boxes) {
    if (!box.field) {
      issues.push({ code: 'T010', level: 'error', message: '有字段框未指定字段', targetId: box.id });
    } else assigned.add(box.field);
  }
  for (const table of map.tables) {
    for (const col of table.columns) {
      if (!col.field) {
        issues.push({ code: 'T010', level: 'error', message: '有列未指定字段', targetId: table.id });
      } else assigned.add(col.field);
    }
  }

  const missing = REQUIRED_CODES.filter(code => !assigned.has(code));
  if (missing.length > 0 && (map.meta_boxes.length > 0 || map.tables.length > 0)) {
    const names = missing.map(code => FIELD_DICT.find(f => f.code === code)?.label ?? code);
    issues.push({ code: 'T003', level: 'error', message: `缺少必填字段：${names.join('、')}` });
  }

  for (const table of map.tables) {
    if (table.columns.length === 0) {
      issues.push({ code: 'T004', level: 'error', message: '表格区需要至少一列，否则无法切分明细', targetId: table.id });
    }
  }

  const seen = new Map<string, string[]>();
  for (const box of map.meta_boxes) {
    if (!box.field) continue;
    seen.set(box.field, [...(seen.get(box.field) ?? []), box.id]);
  }
  for (const [field, ids] of seen) {
    if (ids.length > 1) {
      const label = FIELD_DICT.find(f => f.code === field)?.label ?? field;
      issues.push({ code: 'T005', level: 'error', message: `字段「${label}」被标注了 ${ids.length} 次，请保留一处`, targetId: ids[1] });
    }
  }

  const badRects: string[] = [];
  for (const box of map.meta_boxes) if (!isUsableRect(box.rect)) badRects.push(box.id);
  for (const table of map.tables) if (!isUsableRect(table.area)) badRects.push(table.id);
  if (badRects.length > 0) {
    issues.push({ code: 'T006', level: 'error', message: '有框超出页面范围或尺寸过小，请重画', targetId: badRects[0] });
  }

  const customCodes = new Set<string>();
  for (const cf of map.custom_fields) {
    if (!CODE_PATTERN.test(cf.code)) {
      issues.push({ code: 'T007', level: 'error', message: `自定义字段编码「${cf.code}」不合法，只能用小写字母、数字、下划线` });
    } else if (core.has(cf.code)) {
      issues.push({ code: 'T007', level: 'error', message: `自定义字段「${cf.code}」与内置字段重名` });
    } else if (customCodes.has(cf.code)) {
      issues.push({ code: 'T007', level: 'error', message: `自定义字段「${cf.code}」重复定义` });
    } else if (!cf.label.trim()) {
      issues.push({ code: 'T007', level: 'error', message: `自定义字段「${cf.code}」缺少中文名` });
    }
    customCodes.add(cf.code);
  }

  for (const table of map.tables) {
    for (const col of table.columns) {
      if (col.x < table.area.x - 1e-6 || col.x + col.w > table.area.x + table.area.w + 1e-6) {
        issues.push({ code: 'T008', level: 'error', message: '列区间超出表格区范围', targetId: table.id });
        break;
      }
    }
  }

  if (map.match_rule.header_fingerprint.filter(s => s.trim()).length === 0) {
    issues.push({ code: 'T009', level: 'error', message: '请至少填写一个表头关键词，否则模板无法被自动命中' });
  }

  for (const table of map.tables) {
    for (const box of map.meta_boxes) {
      if (box.page === table.page && insideRect(box.rect, table.area)) {
        issues.push({ code: 'W001', level: 'warning', message: '有字段框落在明细区域内，可能是重复标注', targetId: box.id });
      }
    }
    const cols = [...table.columns].sort((a, b) => a.x - b.x);
    for (let i = 1; i < cols.length; i += 1) {
      const prev = cols[i - 1];
      const cur = cols[i];
      if (prev.field && cur.field && overlaps(
        { x: prev.x, y: 0, w: prev.w, h: 1 },
        { x: cur.x, y: 0, w: cur.w, h: 1 },
      )) {
        issues.push({ code: 'W002', level: 'warning', message: '列之间有重叠，抽取可能串列', targetId: table.id });
        break;
      }
    }
  }

  if (map.tables.length === 0) {
    issues.push({ code: 'W003', level: 'warning', message: '没有表格区，只能取到账户信息，无法解析明细' });
  }
  if (map.page_size.w <= 0 || map.page_size.h <= 0) {
    issues.push({ code: 'W004', level: 'warning', message: '未记录基准页面尺寸，排查问题时不便' });
  }
  if (pageCount > 1 && map.tables.length > 0 && map.tables.every(t => t.page === 1)) {
    issues.push({ code: 'W005', level: 'warning', message: '样例有多页但只标了第 1 页，若明细跨页请补标续页' });
  }

  return issues;
}

export function hasBlockingError(issues: Issue[]): boolean {
  return issues.some(i => i.level === 'error');
}

export function serialize(map: FieldMapV1): string {
  return JSON.stringify(map, null, 2);
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveDraft(map: FieldMapV1): { ok: boolean; message?: string } {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    return { ok: false, message: `草稿保存失败（可能是浏览器存储已满）：${message}` };
  }
}

export function loadDraft(): FieldMapV1 | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FieldMapV1;
    if (parsed.schema_version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* 忽略：存储不可用不影响主流程 */ }
}
