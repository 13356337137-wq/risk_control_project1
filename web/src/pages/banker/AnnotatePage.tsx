import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  inspectFile,
  inspectSample,
  listSamples,
  sampleFileUrl,
  spreadFile,
  spreadKeyword,
  type InspectBand,
  type InspectPage,
  type LabSample,
} from '../../api/lab';
import { createTemplate, getTaskFile, listTasks, updateTemplate, type TaskSummary } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

/**
 * 标注画布：底版就是**原始 PDF 本身**（pdf.js 渲染原页），上面叠系统认出来的列带与单元格。
 *
 * 三个来源：内置样本 / 本地上传 / 已有任务的原件。
 * 模板只声明「我需要哪些列」，位置由版面分析现找；人可以改字段名、拖列带、按关键词补列。
 */
const FIELDS = [
  'txn_date', 'trade_time', 'reference_no', 'summary', 'counterparty_name',
  'direction', 'amount', 'amount_in', 'amount_out', 'balance', 'account_no',
];

type Draft = { field: string; x0: number; x1: number; cells: InspectBand['cells']; source: string };
type Drag = { index: number; mode: 'move' | 'left' | 'right'; startX: number; x0: number; x1: number };
type Source =
  | { kind: 'sample'; label: string; sample: string }
  | { kind: 'file'; label: string; blob: Blob };

export default function AnnotatePage() {
  const navigate = useNavigate();
  const [samples, setSamples] = useState<LabSample[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [pages, setPages] = useState<InspectPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('卡号');
  const [bankCode, setBankCode] = useState('UNKNOWN');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const renderTaskRef = useRef<{ cancel(): void } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  // 默认放大一点：800×1000 pt 的流水页按宽度铺满后正文字号只有 7px 左右，看不清等于没底版
  const [zoom, setZoom] = useState(1.35);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    listSamples()
      .then((data) => {
        setSamples(data.items);
        if (data.items.length) setSource({ kind: 'sample', label: data.items[0].name, sample: data.items[0].name });
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
    listTasks({ limit: 20 })
      .then((data) => setTasks(data.items))
      .catch(() => setTasks([]));
  }, []);

  // 底版 URL：样本走 Lab 静态接口，上传/任务走 blob URL（用完必须 revoke）
  useEffect(() => {
    if (!source) {
      setPdfUrl(null);
      return;
    }
    if (source.kind === 'sample') {
      setPdfUrl(sampleFileUrl(source.sample));
      return;
    }
    const url = URL.createObjectURL(source.blob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const loadLayout = useCallback(async (current: Source) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const report = current.kind === 'sample' ? await inspectSample(current.sample) : await inspectFile(current.blob);
      setPages(report.pages);
      setPageIndex(0);
      setDrafts(toDrafts(report.pages[0]));
      setSelected(null);
      setMessage(
        '已分析：' + report.page_count + ' 页，第 1 页认出 ' + (report.pages[0]?.bands.length ?? 0) + ' 条列带' +
          (report.text_layer ? '' : '（这份文件没有文字层，需要走 OCR）'),
      );
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (source) void loadLayout(source);
  }, [source, loadLayout]);

  const page = pages[pageIndex];
  const scale = fitScale * zoom;

  // 渲染原始 PDF 页
  useEffect(() => {
    if (!page || !pdfUrl) return;
    let cancelled = false;
    (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ url: pdfUrl }).promise;
      const pdfPage = await doc.getPage(pageIndex + 1);
      const base = pdfPage.getViewport({ scale: 1 });
      const containerWidth = stageRef.current?.clientWidth ?? 800;
      const nextFit = Math.max(0.3, Math.min(3, (containerWidth - 24) / base.width));
      const viewport = pdfPage.getViewport({ scale: nextFit * zoom });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return;
      renderTaskRef.current?.cancel();
      const task = pdfPage.render({ canvasContext: context, viewport });
      renderTaskRef.current = task as unknown as { cancel(): void };
      await task.promise;
      if (!cancelled) setFitScale(nextFit);
    })().catch((err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (text.includes('cancel')) return;
      setError('PDF 渲染失败：' + text);
    });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [page, pageIndex, pdfUrl, zoom]);

  const toPage = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (clientX - rect.left) / scale;
  };

  function onPointerDown(event: React.PointerEvent, index: number, mode: Drag['mode']) {
    event.stopPropagation();
    const draft = drafts[index];
    dragRef.current = { index, mode, startX: toPage(event.clientX), x0: draft.x0, x1: draft.x1 };
    setSelected(index);
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = toPage(event.clientX) - drag.startX;
    setDrafts((prev) =>
      prev.map((item, index) => {
        if (index !== drag.index) return item;
        if (drag.mode === 'move') return { ...item, x0: drag.x0 + delta, x1: drag.x1 + delta };
        if (drag.mode === 'left') return { ...item, x0: Math.min(drag.x0 + delta, item.x1 - 6) };
        return { ...item, x1: Math.max(drag.x1 + delta, item.x0 + 6) };
      }),
    );
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function addByKeyword() {
    if (!source || !keyword.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const report =
        source.kind === 'sample'
          ? await spreadKeyword(source.sample, keyword.trim())
          : await spreadFile(source.blob, keyword.trim());
      const bands = report.bands.filter((band) => band.page === pageIndex);
      if (!bands.length) {
        setMessage('这一页没找到「' + keyword + '」。扫描件（无文字层）要先走 OCR。');
        return;
      }
      const added = bands.map((band) => ({
        field: guessField(keyword),
        x0: band.x0,
        x1: band.x1,
        cells: band.cells,
        source: 'keyword:' + keyword,
      }));
      setDrafts((prev) => dedupe([...prev, ...added]));
      setMessage('按「' + keyword + '」扩散到 ' + added.length + ' 条列带。');
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!page) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { width, height } = page;
      const headerY = page.header_y ?? height * 0.12;
      const columns = drafts
        .filter((draft) => draft.field)
        .map((draft) => ({
          field: draft.field,
          fields: [draft.field],
          x: Number((draft.x0 / width).toFixed(4)),
          w: Number(((draft.x1 - draft.x0) / width).toFixed(4)),
        }));
      const fieldMap: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        fieldMap[column.field] = index;
      });
      const layout = {
        page_size: { w: width, h: height },
        page_count: pages.length,
        tables: [
          {
            page: pageIndex,
            slot: 'first',
            area: { x: 0.02, y: Number((headerY / height).toFixed(4)), w: 0.96, h: Number((0.98 - headerY / height).toFixed(4)) },
            headerY: Number((headerY / height).toFixed(4)),
            columns,
          },
        ],
      };
      const created = await createTemplate({ bank_code: bankCode, field_map: fieldMap });
      await updateTemplate(created.id, { field_map: fieldMap, layout });
      setMessage('已保存为模板 #' + created.id + '（草稿）。');
      navigate('/bank/templates/' + created.id);
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  const canvasWidth = page ? page.width * scale : 0;
  const canvasHeight = page ? page.height * scale : 0;

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>标注画布</h1>
          <p className="sub">
            底版是原始 PDF。模板只声明需要哪些列，位置由「关键词定位 + 版面往下扩散」现找；认错就改、偏了就拖、漏了就用关键词补。
          </p>
        </div>
        <div className="filters">
          <select value={bankCode} onChange={(event) => setBankCode(event.target.value)}>
            {['UNKNOWN', 'ICBC', 'CCB', 'CMB', 'ABC', 'BOC'].map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
          <Button onClick={() => void save()} disabled={busy || !drafts.length}>保存为模板</Button>
        </div>
      </header>

      <div className="source-bar">
        <label className="source-item">
          <span>打开原件</span>
          <input
            type="file"
            accept=".pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setSource({ kind: 'file', label: file.name, blob: file });
            }}
          />
        </label>

        <label className="source-item">
          <span>按任务原件</span>
          <select
            value={source?.kind === 'sample' ? '' : ''}
            onChange={(event) => {
              const id = Number(event.target.value);
              if (!id) return;
              setBusy(true);
              getTaskFile(id)
                .then((blob) => setSource({ kind: 'file', label: '任务 #' + id, blob }))
                .catch((err) => setError(getErrorMessage(err, 'banker')))
                .finally(() => setBusy(false));
            }}
          >
            <option value="">选一个已受理任务…</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>#{task.id} {task.biz_no}</option>
            ))}
          </select>
        </label>

        <label className="source-item">
          <span>或内置样本</span>
          <select
            value={source?.kind === 'sample' ? source.sample : ''}
            onChange={(event) => {
              const name = event.target.value;
              if (name) setSource({ kind: 'sample', label: name, sample: name });
            }}
          >
            <option value="">不使用样本</option>
            {samples.map((item) => (
              <option key={item.name} value={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      <div className="annotate">
        <div className="annotate-stage" ref={stageRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <div className="stage-bar">
            <span className="muted small">
              {source ? '原件：' + source.label : '还没有打开原件'}
              {page ? ' · 第 ' + (pageIndex + 1) + '/' + pages.length + ' 页 · ' + Math.round(page.width) + '×' + Math.round(page.height) + ' pt · ' + Math.round(scale * 100) + '%' : ''}
            </span>
            <span className="stage-tools">
              {pages.length > 1
                ? pages.map((item, index) => (
                    <button
                      key={item.index}
                      className={index === pageIndex ? 'active' : ''}
                      onClick={() => {
                        setPageIndex(index);
                        setDrafts(toDrafts(item));
                        setSelected(null);
                      }}
                    >
                      第 {index + 1} 页
                    </button>
                  ))
                : null}
              <button onClick={() => setZoom(Math.max(0.4, zoom - 0.25))}>−</button>
              <button onClick={() => setZoom(Math.min(3, zoom + 0.25))}>+</button>
              <button onClick={() => setZoom(1)}>适应宽度</button>
            </span>
          </div>

          <div className="canvas-wrap" style={{ width: canvasWidth || '100%', height: canvasHeight || 420 }}>
            <canvas ref={canvasRef} />
            {page
              ? drafts.map((draft, index) => (
                  <div
                    key={index}
                    className={'band' + (selected === index ? ' selected' : '')}
                    style={{
                      left: draft.x0 * scale,
                      width: Math.max(6, (draft.x1 - draft.x0) * scale),
                      top: (page.header_y ?? 0) * scale,
                      // 列带只画到最后一个被捡到的单元格，画到页底会像是「这一列一直空着」
                      height: Math.max(
                        12,
                        (draft.cells.length
                          ? Math.max(...draft.cells.map((cell) => cell.y1)) - (page.header_y ?? 0)
                          : page.height - (page.header_y ?? 0)) * scale,
                      ),
                    }}
                    onPointerDown={(event) => onPointerDown(event, index, 'move')}
                    title={draft.field + ' · ' + draft.cells.length + ' 格'}
                  >
                    <span className="band-label">{draft.field}</span>
                    <span className="handle left" onPointerDown={(event) => onPointerDown(event, index, 'left')} />
                    <span className="handle right" onPointerDown={(event) => onPointerDown(event, index, 'right')} />
                    {draft.cells.slice(0, 600).map((cell, cellIndex) => (
                      <span
                        key={cellIndex}
                        className="cell"
                        style={{
                          left: (cell.x0 - draft.x0) * scale,
                          top: (cell.y0 - (page.header_y ?? 0)) * scale,
                          width: Math.max(2, (cell.x1 - cell.x0) * scale),
                          height: Math.max(2, (cell.y1 - cell.y0) * scale),
                        }}
                      />
                    ))}
                  </div>
                ))
              : null}
          </div>
        </div>

        <aside className="annotate-side">
          <div className="lab-save annotate-add">
            <input placeholder="关键词，如 卡号" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            <Button onClick={() => void addByKeyword()} disabled={busy}>按关键词加列</Button>
          </div>

          <div className="band-list">
            {drafts.length === 0 ? <p className="muted small">还没有列带。用上面的关键词加一条。</p> : null}
            {drafts.map((draft, index) => {
              const open = selected === index;
              return (
                <div key={index} className={'band-item' + (open ? ' open' : '')}>
                  <button className="band-head" onClick={() => setSelected(open ? null : index)} aria-expanded={open}>
                    <span className="band-caret">{open ? '▾' : '▸'}</span>
                    <span className="band-name">{draft.field}</span>
                    <span className="band-meta">{Math.round(draft.x0)}–{Math.round(draft.x1)} · {draft.cells.length} 格</span>
                  </button>
                  {open ? (
                    <div className="band-body">
                      <label>
                        字段
                        <select
                          value={draft.field}
                          onChange={(event) =>
                            setDrafts((prev) => prev.map((item, i) => (i === index ? { ...item, field: event.target.value } : item)))
                          }
                        >
                          {(FIELDS.includes(draft.field) ? FIELDS : [draft.field, ...FIELDS]).map((field) => (
                            <option key={field} value={field}>{field}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        x0 / x1（pt）
                        <span className="inline-pair">
                          <input
                            type="number"
                            value={Math.round(draft.x0)}
                            onChange={(event) =>
                              setDrafts((prev) => prev.map((item, i) => (i === index ? { ...item, x0: Number(event.target.value) } : item)))
                            }
                          />
                          <input
                            type="number"
                            value={Math.round(draft.x1)}
                            onChange={(event) =>
                              setDrafts((prev) => prev.map((item, i) => (i === index ? { ...item, x1: Number(event.target.value) } : item)))
                            }
                          />
                        </span>
                      </label>
                      <p className="muted small">来源 {draft.source} · {draft.cells.length} 个单元格</p>
                      <button
                        className="link-btn danger"
                        onClick={() => {
                          setDrafts((prev) => prev.filter((_, i) => i !== index));
                          setSelected(null);
                        }}
                      >
                        删掉这一列
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="muted small">
            没有文字层的扫描件扩不出列带——那不是画布的问题，要走 OCR。保存的是列带（相对宽度），
            同一家银行换一份文件、位置略有偏移也能用。
          </p>
        </aside>
      </div>
    </div>
  );
}

function toDrafts(page?: InspectPage): Draft[] {
  if (!page) return [];
  return page.bands.map((band) => ({
    field: band.field,
    x0: band.x0,
    x1: band.x1,
    cells: band.cells,
    source: band.source,
  }));
}

function dedupe(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const draft of drafts) {
    const overlap = out.find((item) => Math.min(item.x1, draft.x1) - Math.max(item.x0, draft.x0) > (draft.x1 - draft.x0) * 0.5);
    if (overlap) {
      if (draft.cells.length > overlap.cells.length) {
        overlap.x0 = draft.x0;
        overlap.x1 = draft.x1;
        overlap.cells = draft.cells;
        overlap.source = draft.source;
      }
      continue;
    }
    out.push({ ...draft });
  }
  return out;
}

function guessField(keyword: string): string {
  const text = keyword.toLowerCase();
  if (/卡号|账号|account/.test(text)) return 'account_no';
  if (/日期|date/.test(text)) return 'txn_date';
  if (/时间|time/.test(text)) return 'trade_time';
  if (/摘要|用途|summary/.test(text)) return 'summary';
  if (/对方|户名|counterparty/.test(text)) return 'counterparty_name';
  if (/余额|balance/.test(text)) return 'balance';
  if (/金额|amount/.test(text)) return 'amount';
  return 'summary';
}
