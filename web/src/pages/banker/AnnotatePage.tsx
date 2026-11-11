import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  inspectSample,
  listSamples,
  sampleFileUrl,
  spreadKeyword,
  type InspectBand,
  type InspectPage,
  type LabSample,
} from '../../api/lab';
import { createTemplate, updateTemplate } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';

/**
 * 标注画布。
 *
 * 核心态度：模板**不记死坐标**，只声明「我需要哪些列」（卡号、交易日期、金额…）。
 * 系统在新文件上自己找：关键词定位 → 版面把同一列往下扩。这一页就是把那个过程摊开给人看。
 *
 * 所以画布上画的是「系统认出来的列带 + 每列往下捡到的单元格」，人只需要：
 * ① 认错字段名就改；② 列带偏了就拖；③ 漏了的列用关键词补一条。
 */
const FIELDS = [
  'txn_date', 'trade_time', 'reference_no', 'summary', 'counterparty_name',
  'direction', 'amount', 'amount_in', 'amount_out', 'balance', 'account_no',
];

type Draft = { field: string; x0: number; x1: number; cells: InspectBand['cells']; source: string };
type Drag = { index: number; mode: 'move' | 'left' | 'right'; startX: number; x0: number; x1: number };

export default function AnnotatePage() {
  const navigate = useNavigate();
  const [samples, setSamples] = useState<LabSample[]>([]);
  const [sample, setSample] = useState('');
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
  const workerRef = useRef<Worker | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    listSamples()
      .then((data) => {
        setSamples(data.items);
        if (data.items.length) setSample(data.items[0].name);
      })
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, []);

  const loadInspect = useCallback(async (name: string) => {
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      const report = await inspectSample(name);
      setPages(report.pages);
      setPageIndex(0);
      setDrafts(toDrafts(report.pages[0]));
      setSelected(null);
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadInspect(sample);
  }, [sample, loadInspect]);

  const page = pages[pageIndex];

  // pdf.js 渲染：宽度撑满容器，缩放跟着容器走
  useEffect(() => {
    if (!page || !sample) return;
    let cancelled = false;
    (async () => {
      // pdf.js 有 300+KB，动态导入让银行侧主包不带它，只在打开画布时才拉
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      // Vite 下 pdf.js 的 worker 用 workerPort 最稳：?url 导入在 dev/prod 行为不一致
      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
          { type: 'module' },
        );
      }
      pdfjs.GlobalWorkerOptions.workerPort = workerRef.current;
      const doc = await pdfjs.getDocument({ url: sampleFileUrl(sample) }).promise;
      const pdfPage = await doc.getPage(pageIndex + 1);
      const base = pdfPage.getViewport({ scale: 1 });
      const containerWidth = stageRef.current?.clientWidth ?? 820;
      const nextScale = Math.max(0.4, Math.min(2.2, containerWidth / base.width));
      const viewport = pdfPage.getViewport({ scale: nextScale });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return;
      // StrictMode 下 effect 会跑两次；pdf.js 不允许同一块 canvas 上并发渲染，
      // 所以先取消上一次，再开始这一次。
      renderTaskRef.current?.cancel();
      const task = pdfPage.render({ canvasContext: context, viewport });
      renderTaskRef.current = task as unknown as { cancel(): void };
      await task.promise;
      if (!cancelled) setScale(nextScale);
    })().catch((err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (text.includes('RenderingCancelledException') || text.includes('cancelled')) return;
      setError('画布渲染失败：' + text);
    });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [page, pageIndex, sample]);

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
    if (!keyword.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const report = await spreadKeyword(sample, keyword.trim());
      const bands = report.bands.filter((band) => band.page === pageIndex);
      if (!bands.length) {
        setMessage('这一页没找到「' + keyword + '」。可能是扫描件（无文字层），需要走 OCR。');
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
      setMessage('按「' + keyword + '」扩散到 ' + added.length + ' 条列带，共 ' + added.reduce((n, b) => n + b.cells.length, 0) + ' 个单元格。');
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
      const width = page.width;
      const height = page.height;
      const headerY = page.header_y ?? page.height * 0.12;
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

  const current = selected === null ? null : drafts[selected];
  const canvasWidth = page ? page.width * scale : 0;
  const canvasHeight = page ? page.height * scale : 0;

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>标注画布</h1>
          <p className="sub">
            模板只声明需要哪些列；位置由系统按「关键词定位 + 版面往下扩散」现找。认错就改、偏了就拖、漏了就用关键词补。
          </p>
        </div>
        <div className="filters">
          <select value={sample} onChange={(event) => setSample(event.target.value)}>
            {samples.map((item) => (
              <option key={item.name} value={item.name}>{item.name}</option>
            ))}
          </select>
          <select value={bankCode} onChange={(event) => setBankCode(event.target.value.toUpperCase())}>
            {['UNKNOWN', 'ICBC', 'CCB', 'CMB', 'ABC', 'BOC'].map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
          <Button onClick={() => void save()} disabled={busy || !drafts.length}>
            保存为模板
          </Button>
        </div>
      </header>

      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      <div className="annotate">
        <div className="annotate-stage" ref={stageRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          {pages.length > 1 ? (
            <div className="page-tabs">
              {pages.map((item, index) => (
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
              ))}
            </div>
          ) : null}

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
                      height: Math.max(12, page.height * scale - (page.header_y ?? 0) * scale - 8),
                    }}
                    onPointerDown={(event) => onPointerDown(event, index, 'move')}
                    title={draft.field + ' · ' + draft.cells.length + ' 格'}
                  >
                    <span className="band-label">{draft.field}</span>
                    <span className="handle left" onPointerDown={(event) => onPointerDown(event, index, 'left')} />
                    <span className="handle right" onPointerDown={(event) => onPointerDown(event, index, 'right')} />
                    {draft.cells.slice(0, 400).map((cell, cellIndex) => (
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

          {current ? (
            <div className="band-editor">
              <label>
                字段
                <select
                  value={current.field}
                  onChange={(event) =>
                    setDrafts((prev) => prev.map((item, index) => (index === selected ? { ...item, field: event.target.value } : item)))
                  }
                >
                  {FIELDS.map((field) => (
                    <option key={field} value={field}>{field}</option>
                  ))}
                </select>
              </label>
              <label>
                x0 / x1（pt）
                <span className="inline-pair">
                  <input
                    type="number"
                    value={Math.round(current.x0)}
                    onChange={(event) =>
                      setDrafts((prev) => prev.map((item, index) => (index === selected ? { ...item, x0: Number(event.target.value) } : item)))
                    }
                  />
                  <input
                    type="number"
                    value={Math.round(current.x1)}
                    onChange={(event) =>
                      setDrafts((prev) => prev.map((item, index) => (index === selected ? { ...item, x1: Number(event.target.value) } : item)))
                    }
                  />
                </span>
              </label>
              <p className="muted small">
                来源 {current.source} · {current.cells.length} 个单元格
              </p>
              <button
                className="link-btn danger"
                onClick={() => {
                  setDrafts((prev) => prev.filter((_, index) => index !== selected));
                  setSelected(null);
                }}
              >
                删掉这一列
              </button>
            </div>
          ) : null}

          <table className="grid compact annotate-list">
            <thead>
              <tr><th>字段</th><th>x 范围</th><th>格</th></tr>
            </thead>
            <tbody>
              {drafts.map((draft, index) => (
                <tr key={index} className={selected === index ? 'active-row' : ''} onClick={() => setSelected(index)}>
                  <td>{draft.field}</td>
                  <td className="small muted">{Math.round(draft.x0)}–{Math.round(draft.x1)}</td>
                  <td className="small muted">{draft.cells.length}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="muted small">
            没有文字层的扫描件会一条都扩不出来——那不是画布的问题，要走 OCR。保存的是列带（相对宽度），
            所以同一家银行换一份文件、位置略有偏移也能用。
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
