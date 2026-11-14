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
import { createTemplate, getTaskFile, listTasks, publishTemplate, updateTemplate, type TaskSummary } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { getUser } from '../../auth/store';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { COLUMN_LABELS, labelOf } from '../../lib/columns';

/**
 * 标注：三步，不让人学新词。
 *
 * ① 打开一份流水（原件直接铺在画布上）
 * ② 确认系统认出来的列（每列下面直接显示它读到的值，认错就改中文名，偏了就拖）
 * ③ 保存并启用（以后这家银行的同类流水直接用它）
 *
 * 不做的事：不让人填英文代号、不让人理解「列带/归一化/版本/草稿」这些内部词。
 */
type Draft = { field: string; x0: number; x1: number; cells: InspectBand['cells']; source: string };
type Drag = { index: number; mode: 'move' | 'left' | 'right'; startX: number; x0: number; x1: number };
type Source = { kind: 'sample'; label: string; sample: string } | { kind: 'file'; label: string; blob: Blob };
type Single = { field: string; label: string; value: string; x: number; y: number; w: number; h: number; x0: number; x1: number; y0: number; y1: number };

const SINGLE_FIELDS = [
  { key: 'account_no', label: '卡号或账号' },
  { key: 'account_name', label: '户名' },
  { key: 'bank_branch', label: '开户行' },
  { key: 'account_type', label: '账户类型' },
];

const BANKS = [
  { code: 'ICBC', label: '工商银行' }, { code: 'CCB', label: '建设银行' }, { code: 'ABC', label: '农业银行' },
  { code: 'BOC', label: '中国银行' }, { code: 'CMB', label: '招商银行' }, { code: 'PSBC', label: '邮储银行' },
  { code: 'COMM', label: '交通银行' }, { code: 'SPDB', label: '浦发银行' }, { code: 'CIB', label: '兴业银行' },
  { code: 'CITIC', label: '中信银行' }, { code: 'CEB', label: '光大银行' }, { code: 'GDB', label: '广发银行' },
  { code: 'PAB', label: '平安银行' }, { code: 'OTHER', label: '其他 / 不确定' },
];

export default function AnnotatePage() {
  const navigate = useNavigate();
  const isAdmin = Boolean(getUser()?.is_admin);

  const [samples, setSamples] = useState<LabSample[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [pages, setPages] = useState<InspectPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // 单值字段（卡号/户名/开户行…）：整份文件只有一个值，不是列
  const [singles, setSingles] = useState<Single[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [bankCode, setBankCode] = useState('');
  const [keyword, setKeyword] = useState('卡号');
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const renderTaskRef = useRef<{ cancel(): void } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1.35);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    listSamples()
      .then((data) => setSamples(data.items))
      .catch(() => setSamples([]));
    listTasks({ limit: 20 })
      .then((data) => setTasks(data.items))
      .catch(() => setTasks([]));
  }, []);

  useEffect(() => {
    if (!source) return;
    if (source.kind === 'sample') {
      setPdfUrl(sampleFileUrl(source.sample));
      return;
    }
    const url = URL.createObjectURL(source.blob);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const analyse = useCallback(async (current: Source, secret?: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const report =
        current.kind === 'sample'
          ? await inspectSample(current.sample)
          : await inspectFile(current.blob, secret ?? password);
      setNeedPassword(false);   // 口令对了就收起输入框，别一直挂在那儿
      setPages(report.pages);
      setPageIndex(0);
      setDrafts(toDrafts(report.pages[0]));
      setSingles(fromSingles(report.pages[0]));
      setOpenIndex(null);
      const bands = report.pages[0]?.bands.length ?? 0;
      const singleCount = report.pages[0]?.singles?.length ?? 0;
      setMessage(
        report.text_layer
          ? '系统认出 ' + bands + ' 列' + (singleCount ? '，另有 ' + singleCount + ' 个单值信息（卡号、户名这类整份只有一个的）' : '') +
            '。认错就改名字，偏了就拖左边那条线。'
          : '这份文件是扫描件（没有文字层），认不出列。请换一份电子版 PDF，或先在别处做 OCR。',
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'E_ENCRYPT') setNeedPassword(true);
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }, [password]);

  useEffect(() => {
    if (!source) return;
    setNeedPassword(false);
    setPassword('');
    setBankCode('');
    void analyse(source, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const page = pages[pageIndex];
  const scale = fitScale * zoom;

  useEffect(() => {
    if (!page || !pdfUrl) return;
    let cancelled = false;
    (async () => {
      const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({
        url: pdfUrl,
        password: password || undefined,
        // 中文银行流水多用 CID 字体：不带 cMap 时 pdf.js 画不出字，画布一片白，
        // 只剩我们叠上去的框——使用者自然觉得「框是乱画的」。
        cMapUrl: '/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/standard_fonts/',
      }).promise;
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
      if (/password/i.test(text)) {
        setNeedPassword(true);
        setError('这份 PDF 有打开口令，请先填写口令。');
        return;
      }
      setError('原件打不开：' + text);
    });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [page, pageIndex, pdfUrl, zoom, password]);

  const toPage = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (clientX - rect.left) / scale;
  };

  function onPointerDown(event: React.PointerEvent, index: number, mode: Drag['mode']) {
    event.stopPropagation();
    const draft = drafts[index];
    dragRef.current = { index, mode, startX: toPage(event.clientX), x0: draft.x0, x1: draft.x1 };
    setOpenIndex(index);
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

  async function addMissingColumn() {
    if (!source || !keyword.trim()) return;
    setBusy(true);
    setError('');
    try {
      const report =
        source.kind === 'sample'
          ? await spreadKeyword(source.sample, keyword.trim())
          : await spreadFile(source.blob, keyword.trim(), password || undefined);
      const bands = report.bands.filter((band) => band.page === pageIndex);
      if (!bands.length) {
        setMessage('这一页没找到「' + keyword + '」。换个词试试，比如表头上印的那两个字。');
        return;
      }
      setDrafts((prev) =>
        dedupe([
          ...prev,
          ...bands.map((band) => ({
            field: guessField(keyword),
            x0: band.x0,
            x1: band.x1,
            cells: band.cells,
            source: '按「' + keyword + '」找到',
          })),
        ]),
      );
      setMessage('按「' + keyword + '」补上了 ' + bands.length + ' 列。');
    } catch (err) {
      setError(getErrorMessage(err, 'banker'));
    } finally {
      setBusy(false);
    }
  }

  async function saveAndUse() {
    if (!page) return;
    if (!drafts.length) {
      setError('还没有认出的列，先按关键词补一列。');
      return;
    }
    if (!bankCode || bankCode === 'OTHER') {
      setError('先选这是哪家银行——以后同类流水才能自动对上。');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { width, height } = page;
      const headerY = page.header_y ?? height * 0.12;
      const columns = drafts.map((draft) => ({
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
        tables: [{
          page: pageIndex,
          slot: 'first',
          area: { x: 0.02, y: Number((headerY / height).toFixed(4)), w: 0.96, h: Number((0.98 - headerY / height).toFixed(4)) },
          headerY: Number((headerY / height).toFixed(4)),
          columns,
        }],
        // 单值字段：页内框（0-1 比例），解析时按框取值填到页眉（卡号/户名/开户行）
        meta_boxes: singles.map((item) => ({
          field: item.field,
          // 解析侧页号从 1 起（交易行 page_no 也是 1 起），这里必须对齐，否则框永远匹配不到页
          page: pageIndex + 1,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        })),
      };
      const created = await createTemplate({ bank_code: bankCode, field_map: fieldMap });
      await updateTemplate(created.id, { field_map: fieldMap, layout });
      // 使用者要的是「保存完就能用」，不该再去另一个页面点启用
      if (isAdmin) {
        await publishTemplate(created.id);
        setMessage('已保存并启用。以后' + bankLabel(bankCode) + '的同类流水会自动用这份模板解析。');
      } else {
        setMessage('已保存为草稿。启用需要管理员操作，或者让管理员点一下「启用」。');
      }
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
          <h1>教系统认这份流水</h1>
          <p className="sub">
            打开一份流水 → 系统把认出来的列摆在原件上 → 确认没问题就保存。以后这家的同类流水就直接用它。
          </p>
        </div>
        <div className="filters">
          <select value={bankCode} onChange={(event) => setBankCode(event.target.value)}>
            <option value="">这是哪家银行？</option>
            {BANKS.map((bank) => (
              <option key={bank.code} value={bank.code}>{bank.label}</option>
            ))}
          </select>
          <Button onClick={() => void saveAndUse()} disabled={busy || !drafts.length}>
            保存并启用
          </Button>
        </div>
      </header>

      {!source ? (
        <div className="start-box">
          <h2>第一步：打开一份流水</h2>
          <p className="muted">用 PDF 原件就行，有密码也能填。</p>
          <label className="big-file">
            选择 PDF 文件
            <input
              type="file"
              accept=".pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setSource({ kind: 'file', label: file.name, blob: file });
              }}
            />
          </label>
          <div className="start-alt">
            <label>
              或者用已受理的任务原件
              <select
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
                <option value="">选一个任务…</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>#{task.id} {task.biz_no}</option>
                ))}
              </select>
            </label>
            <label>
              或者看内置样例
              <select
                onChange={(event) => {
                  const name = event.target.value;
                  if (name) setSource({ kind: 'sample', label: name, sample: name });
                }}
              >
                <option value="">选一个样例…</option>
                {samples.map((item) => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {needPassword ? (
        <div className="lab-save password-bar">
          <input
            type="password"
            placeholder="这份 PDF 的打开口令"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void analyse(source as Source, password);
            }}
          />
          <Button disabled={busy || !password.trim()} onClick={() => source && void analyse(source, password)}>
            用这个口令打开
          </Button>
        </div>
      ) : null}

      {error ? <Notice>{error}</Notice> : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}

      {source ? (
        <>
          <div className="step-row">
            <span className="step-done">① 已打开：{source.label}</span>
            <button className="link-btn" onClick={() => { setSource(null); setDrafts([]); setPages([]); setMessage(''); }}>
              换一个文件
            </button>
          </div>

          <div className="annotate">
            <div className="annotate-stage" ref={stageRef} onPointerMove={onPointerMove} onPointerUp={() => (dragRef.current = null)}>
              <div className="stage-bar">
                <span className="muted small">
                  第 {pageIndex + 1}/{pages.length || 1} 页
                  {page ? ' · ' + Math.round(page.width) + '×' + Math.round(page.height) + ' pt · ' + Math.round(scale * 100) + '%' : ''}
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
                            setOpenIndex(null);
                          }}
                        >
                          第 {index + 1} 页
                        </button>
                      ))
                    : null}
                  <button onClick={() => setZoom(Math.max(0.4, zoom - 0.25))}>缩小</button>
                  <button onClick={() => setZoom(Math.min(3, zoom + 0.25))}>放大</button>
                  <button onClick={() => setZoom(1)}>整页</button>
                </span>
              </div>

              <p className="legend">
                <span className="legend-item"><i className="swatch swatch-col" />蓝框＝一列（每行都有），框里的小格是这一列读到的每个值</span>
                <span className="legend-item"><i className="swatch swatch-single" />紫框＝整份只有一个的信息（卡号、户名这类）</span>
                <span className="legend-item">框的位置就是系统实际取值的位置，可以拖动校正</span>
              </p>

              <div className="canvas-wrap" style={{ width: canvasWidth || '100%', height: canvasHeight || 420 }}>
                <canvas ref={canvasRef} />
                {page
                  ? singles.map((item, index) => (
                      <div
                        key={'single-' + index}
                        className="single-box"
                        style={{
                          left: item.x * page.width * scale,
                          top: item.y * page.height * scale,
                          width: Math.max(8, item.w * page.width * scale),
                          height: Math.max(8, item.h * page.height * scale),
                        }}
                        title={item.label + '：' + item.value}
                      >
                        <span className="single-label">{item.label}</span>
                      </div>
                    ))
                  : null}
                {page
                  ? drafts.map((draft, index) => (
                      <div
                        key={index}
                        className={'band' + (openIndex === index ? ' selected' : '')}
                        style={(() => {
                          // 框只该圈住「实际读到的格子」：从第一个格子上沿到最后一行下沿。
                          // 用表头 y 当起点会把列名也圈进去，看着像系统把标题当数据。
                          const top = draft.cells.length
                            ? Math.min(...draft.cells.map((cell) => cell.y0))
                            : (page.header_y ?? page.height * 0.1);
                          const bottom = draft.cells.length
                            ? Math.max(...draft.cells.map((cell) => cell.y1))
                            : page.height;
                          return {
                            left: draft.x0 * scale,
                            width: Math.max(6, (draft.x1 - draft.x0) * scale),
                            top: top * scale,
                            height: Math.max(12, (bottom - top) * scale),
                          };
                        })()}
                        onPointerDown={(event) => onPointerDown(event, index, 'move')}
                        title={labelOf(draft.field) + ' · 读到 ' + draft.cells.length + ' 个值'}
                      >
                        <span className="band-label">{labelOf(draft.field)}</span>
                        <span className="handle left" onPointerDown={(event) => onPointerDown(event, index, 'left')} />
                        <span className="handle right" onPointerDown={(event) => onPointerDown(event, index, 'right')} />
                        {draft.cells.slice(0, 600).map((cell, cellIndex) => (
                          <span
                            key={cellIndex}
                            className="cell"
                            style={{
                              left: (cell.x0 - draft.x0) * scale,
                              top: (cell.y0 - (draft.cells.length ? Math.min(...draft.cells.map((item) => item.y0)) : (page.header_y ?? 0))) * scale,
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
              <div className="step-head">
                <strong>② 系统认出的列（{drafts.length}）</strong>
                <span className="muted small">每列下面写着它读到的值</span>
              </div>

              <div className="band-list">
                {drafts.map((draft, index) => {
                  const open = openIndex === index;
                  return (
                    <div key={index} className={'band-item' + (open ? ' open' : '')}>
                      <button className="band-head" onClick={() => setOpenIndex(open ? null : index)} aria-expanded={open}>
                        <span className="band-caret">{open ? '▾' : '▸'}</span>
                        <span className="band-name">{labelOf(draft.field)}</span>
                        <span className="band-meta">读到 {draft.cells.length} 个值</span>
                      </button>
                      <p className="band-preview">
                        {draft.cells.slice(0, 3).map((cell) => cell.text).join(' · ') || '（这一列没读到值）'}
                      </p>
                      {open ? (
                        <div className="band-body">
                          <label>
                            这一列是什么？
                            <select
                              value={draft.field}
                              onChange={(event) =>
                                setDrafts((prev) => prev.map((item, i) => (i === index ? { ...item, field: event.target.value } : item)))
                              }
                            >
                              {COLUMN_LABELS.map((item) => (
                                <option key={item.key} value={item.key}>
                                  {item.label}{item.hint ? '（' + item.hint + '）' : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="muted small">
                            位置不对就在左边原件上拖这一列，或拖它左右两边的竖线调整宽窄。
                          </p>
                          <button
                            className="link-btn danger"
                            onClick={() => {
                              setDrafts((prev) => prev.filter((_, i) => i !== index));
                              setOpenIndex(null);
                            }}
                          >
                            这一列不要
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="step-head">
                <strong>单值信息（{singles.length}）</strong>
                <span className="muted small">整份文件只有一个的属性，不是列</span>
              </div>
              <div className="band-list">
                {singles.length === 0 ? (
                  <p className="muted small">没找到卡号、户名这类单值信息。</p>
                ) : (
                  singles.map((item, index) => (
                    <div key={index} className="band-item open">
                      <div className="band-head" style={{ cursor: 'default' }}>
                        <span className="band-caret">·</span>
                        <span className="band-name">{item.label}</span>
                        <span className="band-meta">{item.value}</span>
                      </div>
                      <div className="band-body">
                        <label>
                          这一项是什么？
                          <select
                            value={item.field}
                            onChange={(event) =>
                              setSingles((prev) => prev.map((row, i) => (i === index ? { ...row, field: event.target.value, label: labelOfSingle(event.target.value) } : row)))
                            }
                          >
                            {SINGLE_FIELDS.map((field) => (
                              <option key={field.key} value={field.key}>{field.label}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="link-btn danger"
                          onClick={() => setSingles((prev) => prev.filter((_, i) => i !== index))}
                        >
                          这一项不要
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="lab-save annotate-add">
                <input placeholder="少了一列？输入表头上的字，如 卡号" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                <Button onClick={() => void addMissingColumn()} disabled={busy}>补一列</Button>
              </div>

              <div className="step-head">
                <strong>③ 没问题就保存</strong>
              </div>
              <p className="muted small">
                保存后这份模板会自动启用。以后同一家银行的同类流水上传后就不用再教了。
                {isAdmin ? '' : '（你没有启用权限，会先存成草稿。）'}
              </p>
              <Button onClick={() => void saveAndUse()} disabled={busy || !drafts.length}>
                保存并启用
              </Button>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

function fromSingles(page?: InspectPage): Single[] {
  return (page?.singles ?? []).map((item) => ({
    field: item.field,
    label: item.label,
    value: item.value,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    x0: item.x0,
    x1: item.x1,
    y0: item.y0,
    y1: item.y1,
  }));
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

function labelOfSingle(field: string) {
  return SINGLE_FIELDS.find((item) => item.key === field)?.label ?? field;
}

function bankLabel(code: string) {
  return BANKS.find((bank) => bank.code === code)?.label ?? code;
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
