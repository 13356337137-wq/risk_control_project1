import type { InspectBand, InspectCell, InspectPage, InspectSingle } from '../../api/lab';
import { COLUMN_LABELS, labelOf } from '../../lib/columns';

export type ToolMode = 'select' | 'draw_col' | 'draw_area' | 'draw_single' | 'header_line' | 'spread';
export type PageSlot = 'first' | 'middle' | 'last' | 'auto';

export type NormalizedArea = { x: number; y: number; w: number; h: number };

export type TableRegionBox = {
  id: string;
  page: number; // 0-based
  slot: PageSlot;
  area: NormalizedArea;
  headerY: number; // normalized [0, 1]
};

export type ColumnBox = {
  id: string;
  regionId: string;
  field: string;
  label?: string;
  x: number; // normalized [0, 1]
  w: number; // normalized [0, 1]
  source: string;
  confidence: number;
  cells: InspectCell[]; // raw points from inspect, kept for count/preview
  cellNorms?: { x0: number; x1: number; y0: number; y1: number; text: string }[];
};

export type SingleBox = {
  id: string;
  field: string;
  label: string;
  value: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  manual?: boolean;
};

export type CustomFieldOption = { key: string; label: string; hint?: string };

export type AnnotateSnapshot = {
  regions: TableRegionBox[];
  columns: ColumnBox[];
  singles: SingleBox[];
};

export const BOX_COLORS = ['#dc2626', '#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

export const BANK_OPTIONS: { code: string; label: string }[] = [
  { code: 'ICBC', label: '工商银行' },
  { code: 'CCB', label: '建设银行' },
  { code: 'ABC', label: '农业银行' },
  { code: 'BOC', label: '中国银行' },
  { code: 'CMB', label: '招商银行' },
  { code: 'COMM', label: '交通银行' },
  { code: 'PSBC', label: '邮储银行' },
  { code: 'CGB', label: '广发银行' },
  { code: 'CEB', label: '光大银行' },
  { code: 'PAB', label: '平安银行' },
  { code: 'SPDB', label: '浦发银行' },
  { code: 'CITIC', label: '中信银行' },
  { code: 'CIB', label: '兴业银行' },
  { code: 'CMBC', label: '民生银行' },
  { code: 'WECHAT', label: '微信账单' },
  { code: 'ALIPAY', label: '支付宝账单' },
];

export const SINGLE_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'account_no', label: '卡号或账号' },
  { key: 'account_name', label: '户名' },
  { key: 'bank_branch', label: '开户行' },
  { key: 'account_type', label: '账户类型' },
];

export const DEFAULT_REQUIRED_FIELDS = ['txn_date', 'amount', 'balance'];

export function bankLabel(code: string): string {
  const upper = (code || '').toUpperCase();
  return BANK_OPTIONS.find((item) => item.code === upper)?.label ?? (upper || '未选择');
}

export function uid(prefix: string): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

export function fieldLabel(key: string, customFields: CustomFieldOption[]): string {
  const custom = customFields.find((f) => f.key === key);
  if (custom) return custom.label;
  return labelOf(key);
}

export function allFieldOptions(customFields: CustomFieldOption[]): CustomFieldOption[] {
  const existingKeys = new Set(COLUMN_LABELS.map((c) => c.key));
  const extra = customFields.filter((c) => !existingKeys.has(c.key));
  return [...COLUMN_LABELS, ...extra];
}

function clamp01(val: number): number {
  return Math.max(0, Math.min(1, val));
}

export function buildBoxesFromInspectPage(page: InspectPage | undefined, pageIndex: number): {
  regions: TableRegionBox[];
  columns: ColumnBox[];
  singles: SingleBox[];
} {
  if (!page || page.width <= 0 || page.height <= 0) {
    return {
      regions: [
        {
          id: uid('reg'),
          page: pageIndex,
          slot: pageIndex === 0 ? 'first' : 'middle',
          area: { x: 0.03, y: 0.16, w: 0.94, h: 0.76 },
          headerY: 0.16,
        },
      ],
      columns: [],
      singles: [],
    };
  }

  const W = page.width;
  const H = page.height;
  const rawRegions = page.regions && page.regions.length > 0
    ? page.regions
    : [
        {
          area: computeUnionArea(page.bands, page.header_y, W, H),
          header_y: page.header_y,
          bands: page.bands,
        },
      ];

  const regions: TableRegionBox[] = [];
  const columns: ColumnBox[] = [];

  rawRegions.forEach((reg, rIdx) => {
    const rid = uid('reg');
    const hy = reg.header_y !== null && reg.header_y !== undefined
      ? clamp01(reg.header_y <= 1 ? reg.header_y : reg.header_y / H)
      : clamp01(reg.area.y);
    regions.push({
      id: rid,
      page: pageIndex,
      slot: pageIndex === 0 && rIdx === 0 ? 'first' : 'middle',
      area: {
        x: clamp01(reg.area.x),
        y: clamp01(reg.area.y),
        w: Math.max(0.05, Math.min(1 - clamp01(reg.area.x), reg.area.w)),
        h: Math.max(0.05, Math.min(1 - clamp01(reg.area.y), reg.area.h)),
      },
      headerY: hy,
    });
    (reg.bands || []).forEach((b: InspectBand) => {
      const nx = clamp01(b.x0 / W);
      const nw = Math.max(0.012, Math.min(1 - nx, (b.x1 - b.x0) / W));
      columns.push({
        id: uid('col'),
        regionId: rid,
        field: b.field,
        x: nx,
        w: nw,
        source: b.source || 'auto',
        confidence: b.confidence ?? 0.8,
        cells: b.cells || [],
        cellNorms: (b.cells || []).slice(0, 12).map((c) => ({
          x0: clamp01(c.x0 / W),
          x1: clamp01(c.x1 / W),
          y0: clamp01(c.y0 / H),
          y1: clamp01(c.y1 / H),
          text: c.text,
        })),
      });
    });
  });

  const singles: SingleBox[] = (page.singles || []).map((s: InspectSingle) => ({
    id: uid('meta'),
    field: s.field,
    label: s.label,
    value: s.value,
    page: s.page,
    x: clamp01(s.x),
    y: clamp01(s.y),
    w: Math.max(0.02, Math.min(1 - clamp01(s.x), s.w)),
    h: Math.max(0.015, Math.min(1 - clamp01(s.y), s.h)),
  }));

  return { regions, columns, singles };
}

function computeUnionArea(bands: InspectBand[], headerY: number | null, W: number, H: number): NormalizedArea {
  if (!bands || bands.length === 0) {
    return { x: 0.03, y: 0.16, w: 0.94, h: 0.76 };
  }
  const minX = Math.min(...bands.map((b) => b.x0));
  const maxX = Math.max(...bands.map((b) => b.x1));
  const allCells = bands.flatMap((b) => b.cells || []);
  const minY = headerY ?? (allCells.length ? Math.min(...allCells.map((c) => c.y0)) : H * 0.15);
  const maxY = allCells.length ? Math.max(...allCells.map((c) => c.y1)) : H * 0.88;
  const x = clamp01((minX - W * 0.015) / W);
  const y = clamp01((minY - H * 0.01) / H);
  const x1 = clamp01((maxX + W * 0.015) / W);
  const y1 = clamp01((maxY + H * 0.015) / H);
  return {
    x,
    y,
    w: Math.max(0.1, x1 - x),
    h: Math.max(0.08, y1 - y),
  };
}

export function fromSavedLayout(layoutRaw: unknown): {
  regions: TableRegionBox[];
  columns: ColumnBox[];
  singles: SingleBox[];
  customFields: CustomFieldOption[];
} {
  const lay = (layoutRaw || {}) as {
    tables?: {
      page?: number;
      slot?: PageSlot;
      area?: NormalizedArea;
      headerY?: number;
      columns?: { field?: string; fields?: string[]; label?: string; x: number; w: number }[];
    }[];
    meta_boxes?: { field: string; label?: string; value?: string; page?: number; x: number; y: number; w: number; h: number }[];
    custom_fields?: CustomFieldOption[];
  };
  const regions: TableRegionBox[] = [];
  const columns: ColumnBox[] = [];
  for (const t of lay.tables || []) {
    const rid = uid('reg');
    const area = t.area || { x: 0.03, y: 0.16, w: 0.94, h: 0.76 };
    regions.push({
      id: rid,
      page: Number(t.page ?? 0),
      slot: (t.slot as PageSlot) || 'auto',
      area: {
        x: clamp01(Number(area.x ?? 0.03)),
        y: clamp01(Number(area.y ?? 0.16)),
        w: Math.max(0.04, Math.min(1, Number(area.w ?? 0.94))),
        h: Math.max(0.04, Math.min(1, Number(area.h ?? 0.76))),
      },
      headerY: clamp01(Number(t.headerY ?? area.y ?? 0.16)),
    });
    for (const c of t.columns || []) {
      const fkey = c.field || c.fields?.[0] || 'summary';
      columns.push({
        id: uid('col'),
        regionId: rid,
        field: fkey,
        label: c.label,
        x: clamp01(Number(c.x ?? 0)),
        w: Math.max(0.012, Math.min(1, Number(c.w ?? 0.08))),
        source: 'saved',
        confidence: 1,
        cells: [],
      });
    }
  }
  const singles: SingleBox[] = (lay.meta_boxes || []).map((m) => ({
    id: uid('meta'),
    field: m.field,
    label: m.label || SINGLE_FIELD_OPTIONS.find((s) => s.key === m.field)?.label || m.field,
    value: m.value || '',
    page: Number(m.page ?? 0),
    x: clamp01(Number(m.x ?? 0)),
    y: clamp01(Number(m.y ?? 0)),
    w: Math.max(0.02, Math.min(1, Number(m.w ?? 0.12))),
    h: Math.max(0.015, Math.min(1, Number(m.h ?? 0.03))),
    manual: true,
  }));
  return { regions, columns, singles, customFields: lay.custom_fields || [] };
}

export function buildTemplatePayload(
  regions: TableRegionBox[],
  columns: ColumnBox[],
  singles: SingleBox[],
  customFields: CustomFieldOption[],
  pageSize?: { w: number; h: number },
  pageCount = 1,
): { fieldMap: Record<string, string>; layout: Record<string, unknown> } {
  const fieldMap: Record<string, string> = {};
  const tables = regions.map((reg) => {
    const regCols = columns
      .filter((c) => c.regionId === reg.id && c.field)
      .sort((a, b) => a.x - b.x)
      .map((c) => {
        fieldMap[c.field] = fieldLabel(c.field, customFields);
        return {
          field: c.field,
          fields: [c.field],
          label: fieldLabel(c.field, customFields),
          x: Number(clamp01(c.x).toFixed(4)),
          w: Number(Math.max(0.008, Math.min(1 - clamp01(c.x), c.w)).toFixed(4)),
        };
      });
    return {
      page: reg.page,
      slot: reg.slot,
      area: {
        x: Number(clamp01(reg.area.x).toFixed(4)),
        y: Number(clamp01(reg.area.y).toFixed(4)),
        w: Number(Math.max(0.02, Math.min(1 - clamp01(reg.area.x), reg.area.w)).toFixed(4)),
        h: Number(Math.max(0.02, Math.min(1 - clamp01(reg.area.y), reg.area.h)).toFixed(4)),
      },
      headerY: Number(clamp01(reg.headerY).toFixed(4)),
      columns: regCols,
    };
  });

  const metaBoxes = singles.map((s) => ({
    field: s.field,
    label: s.label,
    value: s.value,
    page: s.page,
    x: Number(clamp01(s.x).toFixed(4)),
    y: Number(clamp01(s.y).toFixed(4)),
    w: Number(Math.max(0.015, Math.min(1 - clamp01(s.x), s.w)).toFixed(4)),
    h: Number(Math.max(0.012, Math.min(1 - clamp01(s.y), s.h)).toFixed(4)),
  }));

  return {
    fieldMap,
    layout: {
      ...(pageSize ? { page_size: pageSize } : {}),
      page_count: pageCount,
      tables,
      meta_boxes: metaBoxes,
      ...(customFields.length > 0 ? { custom_fields: customFields } : {}),
    },
  };
}
