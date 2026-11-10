import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTemplate, probeTemplate, updateTemplate, type ProbeResult } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

/**
 * 标注页（第一版：预读驱动的自动标注）。
 *
 * 与旧版 1046 行的画布编辑器相比，这一版先只做「最常用的一条路」：
 * 上传样本 → 后台预读认出表头与列 → 自动生成列带 → 人工微调 x/w 与字段 → 保存。
 *
 * 手绘框（表格区拖动、画新列、八个手柄、缩放拉条）**还没迁**，这是明确的下一步。
 * 之所以先做这条路：预读已经能给出建议标注，多数模板调几个数值就够用；
 * 而画布交互是封存版失败过 5 次以上的地方，必须单独、谨慎地做。
 */
type ColumnDraft = { field: string; x: number; w: number };

const FIELDS = [
  'txn_date', 'trade_time', 'reference_no', 'summary', 'counterparty_name',
  'direction', 'amount', 'amount_in', 'amount_out', 'balance', 'account_no',
];

export default function AnnotatePage() {
  const navigate = useNavigate();
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [bankCode, setBankCode] = useState('UNKNOWN');
  const [columns, setColumns] = useState<ColumnDraft[]>([]);
  const [area, setArea] = useState({ x: 0.03, y: 0.15, w: 0.9, h: 0.8 });
  const [headerY, setHeaderY] = useState(0.17);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const result = await probeTemplate(file);
      setProbe(result);
      setBankCode(result.bank_code ?? 'UNKNOWN');
      const width = result.page_size.width || 1;
      const suggestions = result.suggestions ?? [];
      setColumns(
        suggestions.map((item) => ({
          field: item.field,
          x: Number((item.x / width).toFixed(4)),
          w: 0.06,
        })),
      );
      if (result.table_area) {
        setArea({
          x: result.table_area.x,
          y: result.table_area.y,
          w: result.table_area.w,
          h: result.table_area.h,
        });
        if (result.table_area.header_y != null) setHeaderY(result.table_area.header_y);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  const fieldMap = useMemo(() => {
    const map: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      if (column.field) map[column.field] = index;
    });
    return map;
  }, [columns]);

  async function save() {
    if (!columns.length) {
      setError('至少要有一列才能保存。');
      return;
    }
    if (bankCode === 'UNKNOWN') {
      setError('请先选择银行代码（预读没认出来时可以手填）。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const layout = {
        page_size: { w: probe?.page_size.width ?? 595, h: probe?.page_size.height ?? 842 },
        page_count: 1,
        tables: [
          {
            page: 0,
            slot: 'first',
            area,
            headerY,
            columns: columns.filter((column) => column.field).map((column) => ({
              field: column.field,
              fields: [column.field],
              x: column.x,
              w: column.w,
            })),
          },
        ],
      };
      const created = await createTemplate({ bank_code: bankCode, field_map: fieldMap });
      await updateTemplate(created.id, { field_map: fieldMap, layout });
      navigate('/bank/templates/' + created.id);
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>标注模板</h1>
          <p className="sub">上传一份样本，系统预读后给出建议列；确认几何与字段后保存为草稿模板。</p>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}

      <section className="annotate-step">
        <h2>① 选择样本</h2>
        <input
          type="file"
          accept=".pdf"
          onChange={(event) => void onPick(event.target.files?.[0] ?? null)}
          disabled={busy}
        />
        {busy ? <p className="muted small">预读中…</p> : null}
        {probe ? (
          <p className="muted small">
            预读结果：{probe.bank_name ?? probe.bank_code ?? '未识别银行'} · 页面 {probe.page_size.width}×
            {probe.page_size.height} pt · 旋转 {probe.rotation}° · {probe.header_found ? '找到表头' : '没找到表头'}
          </p>
        ) : null}
      </section>

      {probe ? (
        <>
          <section className="annotate-step">
            <h2>② 银行与表格区</h2>
            <div className="grid-4">
              <label>
                银行代码
                <input value={bankCode} onChange={(event) => setBankCode(event.target.value.toUpperCase())} />
              </label>
              <label>
                表头 y
                <input type="number" step="0.005" value={headerY} onChange={(event) => setHeaderY(Number(event.target.value))} />
              </label>
              <label>
                区域 x / w
                <span className="inline-pair">
                  <input type="number" step="0.005" value={area.x} onChange={(event) => setArea({ ...area, x: Number(event.target.value) })} />
                  <input type="number" step="0.005" value={area.w} onChange={(event) => setArea({ ...area, w: Number(event.target.value) })} />
                </span>
              </label>
              <label>
                区域 y / h
                <span className="inline-pair">
                  <input type="number" step="0.005" value={area.y} onChange={(event) => setArea({ ...area, y: Number(event.target.value) })} />
                  <input type="number" step="0.005" value={area.h} onChange={(event) => setArea({ ...area, h: Number(event.target.value) })} />
                </span>
              </label>
            </div>
          </section>

          <section className="annotate-step">
            <h2>③ 列（{columns.length}）</h2>
            <table className="grid compact">
              <thead>
                <tr><th>字段</th><th>起点 x</th><th>宽度 w</th><th>右边界</th><th /></tr>
              </thead>
              <tbody>
                {columns.map((column, index) => (
                  <tr key={index}>
                    <td>
                      <select
                        value={column.field}
                        onChange={(event) => {
                          const next = [...columns];
                          next[index] = { ...column, field: event.target.value };
                          setColumns(next);
                        }}
                      >
                        {FIELDS.map((field) => (
                          <option key={field} value={field}>{field}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.005"
                        value={column.x}
                        onChange={(event) => {
                          const next = [...columns];
                          next[index] = { ...column, x: Number(event.target.value) };
                          setColumns(next);
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.005"
                        value={column.w}
                        onChange={(event) => {
                          const next = [...columns];
                          next[index] = { ...column, w: Number(event.target.value) };
                          setColumns(next);
                        }}
                      />
                    </td>
                    <td className="muted small">{(column.x + column.w).toFixed(3)}</td>
                    <td>
                      <button className="link-btn" onClick={() => setColumns(columns.filter((_, i) => i !== index))}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="link-btn" onClick={() => setColumns([...columns, { field: 'summary', x: 0.5, w: 0.08 }])}>
              + 加一列
            </button>
          </section>

          <div className="actions">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? '保存中…' : '保存为草稿模板'}
            </Button>
          </div>
        </>
      ) : null}

      <p className="muted small">
        手绘框（拖表格区、画列、改大小、缩放）还没迁到新版，需要时先用旧入口 /bank-old/ 标注。
      </p>
    </div>
  );
}
