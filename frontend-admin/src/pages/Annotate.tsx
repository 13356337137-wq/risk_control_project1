import { useEffect, useMemo, useState } from 'react';
import { Toolbar } from '../components/Toolbar';
import { Stage } from '../components/Stage';
import { Inspector } from '../components/Inspector';
import { ValidationPanel } from '../components/ValidationPanel';
import {
  clearDraft, createEmpty, downloadText, hasBlockingError,
  loadDraft, saveDraft, serialize, uid, validate,
} from '../lib/template';
import { openSampleFile } from '../lib/pdf';
import { createDemoPage } from '../lib/sample';
import { ocrDemo, LOW_CONF, type DemoLine } from '../lib/demo';
import type { FieldMapV1, Issue, Rect, SamplePage, Selection, Tool } from '../lib/types';

type Notice = { level: 'info' | 'error' | 'warning'; text: string } | null;

export function AnnotatePage() {
  const [map, setMap] = useState<FieldMapV1>(() => loadDraft() ?? createEmpty());
  const [sample, setSample] = useState<SamplePage | null>(null);
  const [sampleName, setSampleName] = useState('');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>('meta');
  const [sel, setSel] = useState<Selection>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [demoLines, setDemoLines] = useState<DemoLine[] | null>(null);

  const pageCount = sample?.pageCount ?? 1;
  const issues: Issue[] = useMemo(() => validate(map, pageCount), [map, pageCount]);
  const blocking = issues.filter(i => i.level === 'error').length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const res = saveDraft(map);
      if (!res.ok) setNotice({ level: 'warning', text: res.message ?? '草稿保存失败' });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    const current = sample;
    return () => { current?.dispose(); };
  }, [sample]);

  function hint(text: string) { setNotice({ level: 'info', text }); }

  async function loadFile(file: File) {
    try {
      const opened = await openSampleFile(file);
      setSample(opened);
      setSampleName(file.name);
      setPage(1);
      setSel(null);
      setMap(prev => ({
        ...prev,
        page_size: { w: Math.round(opened.width * 100) / 100, h: Math.round(opened.height * 100) / 100 },
        meta: { ...prev.meta, sample_name: file.name },
      }));
      setNotice({ level: 'info', text: `已载入 ${file.name}（${opened.pageCount} 页）。样例只在本机读取，不会上传。` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setNotice({ level: 'error', text: msg });
    }
  }

  function loadDemo() {
    const demo = createDemoPage();
    setSample(demo);
    setSampleName('内置示例页（假数据）');
    setPage(1);
    setSel(null);
    setMap(prev => ({
      ...prev,
      page_size: { w: demo.width, h: demo.height },
      meta: { ...prev.meta, sample_name: 'demo.png' },
    }));
    setNotice({ level: 'info', text: '已载入内置示例页，可直接练习标注。' });
  }

  function draw(rect: Rect) {
    if (!sample) { hint('先载入样例文件或点「示例页」'); return; }
    if (tool === 'meta') {
      const box = { id: uid('m'), field: '', page, rect };
      setMap(prev => ({ ...prev, meta_boxes: [...prev.meta_boxes, box] }));
      setSel({ kind: 'meta', id: box.id });
      hint('已画字段框，请在右侧选择它对应的字段。');
      return;
    }
    if (tool === 'table') {
      const table = { id: uid('t'), page, area: rect, columns: [] };
      setMap(prev => ({ ...prev, tables: [...prev.tables, table] }));
      setSel({ kind: 'table', id: table.id });
      hint('已画表格区。接着点「画列边界」，在区域内拖出每一列。');
      return;
    }
    const target = sel && (sel.kind === 'table' || sel.kind === 'column') ? sel : null;
    const tableId = target ? (target.kind === 'table' ? target.id : target.tableId) : '';
    const table = map.tables.find(t => t.id === tableId);
    if (!table) { hint('请先选中一个表格区，再画列'); return; }
    const x = Math.max(table.area.x, rect.x);
    const right = Math.min(table.area.x + table.area.w, rect.x + rect.w);
    if (right - x < 0.002) { hint('列宽太小或超出表格区，已忽略'); return; }
    const column = { field: '', x, w: Math.round((right - x) * 10000) / 10000 };
    setMap(prev => ({
      ...prev,
      tables: prev.tables.map(t => (t.id === table.id ? { ...t, columns: [...t.columns, column] } : t)),
    }));
    setSel({ kind: 'column', tableId: table.id, index: table.columns.length });
    hint('已加一列，请在右侧给它指定字段。');
  }

  function moveRect(kind: 'meta' | 'table', id: string, rect: Rect) {
    setMap(prev => {
      if (kind === 'meta') {
        return { ...prev, meta_boxes: prev.meta_boxes.map(b => (b.id === id ? { ...b, rect } : b)) };
      }
      return { ...prev, tables: prev.tables.map(t => (t.id === id ? { ...t, area: rect } : t)) };
    });
  }

  function removeSelected() {
    if (!sel) return;
    setMap(prev => {
      if (sel.kind === 'meta') return { ...prev, meta_boxes: prev.meta_boxes.filter(b => b.id !== sel.id) };
      if (sel.kind === 'table') return { ...prev, tables: prev.tables.filter(t => t.id !== sel.id) };
      return {
        ...prev,
        tables: prev.tables.map(t => (t.id === sel.tableId
          ? { ...t, columns: t.columns.filter((_, i) => i !== sel.index) }
          : t)),
      };
    });
    setSel(null);
  }

  function assign(field: string) {
    if (!sel) return;
    setMap(prev => {
      if (sel.kind === 'meta') {
        return { ...prev, meta_boxes: prev.meta_boxes.map(b => (b.id === sel.id ? { ...b, field } : b)) };
      }
      if (sel.kind === 'column') {
        return {
          ...prev,
          tables: prev.tables.map(t => (t.id === sel.tableId
            ? { ...t, columns: t.columns.map((c, i) => (i === sel.index ? { ...c, field } : c)) }
            : t)),
        };
      }
      return prev;
    });
  }

  function save() {
    if (blocking > 0) {
      setNotice({ level: 'error', text: `还有 ${blocking} 项错误未处理，先按右侧检查清单修完再保存。` });
      return;
    }
    const text = serialize(map);
    const safeBank = map.bank_code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'template';
    downloadText(`field_map_${safeBank}.json`, text);
    const res = saveDraft(map);
    setNotice({
      level: res.ok ? 'info' : 'warning',
      text: res.ok
        ? '已导出 field_map JSON 并保存草稿。注意：试解析接口尚未接入，当前只做了本地标注检查。'
        : `已导出 JSON，但草稿保存失败：${res.message ?? ''}`,
    });
  }

  function reset() {
    if (!window.confirm('清空所有标注？此操作不可撤销。')) return;
    clearDraft();
    setMap(createEmpty());
    setSel(null);
    setNotice({ level: 'info', text: '已清空标注。' });
  }

  function runDemoParse() {
    if (!sample) { hint('先载入样例或点「示例页」，再试解析'); return; }
    setDemoLines(ocrDemo.lines);
    const low = ocrDemo.lines.filter(l => l.confidence < LOW_CONF).length;
    setNotice({
      level: low > 0 ? 'warning' : 'info',
      text: `演示试解析完成：${ocrDemo.lines.length} 个字段值，其中 ${low} 个低置信（<${LOW_CONF}，已标红）。完整率 ${(ocrDemo.self_check.field_completeness * 100).toFixed(1)}%，平均置信度 ${(ocrDemo.self_check.avg_confidence * 100).toFixed(1)}%。这是样例数据，真实结果需后端 dry-run。`,
    });
  }

  return (
    <div className="app">
      <Toolbar
        tool={tool}
        onTool={setTool}
        page={page}
        pageCount={pageCount}
        onPage={p => { setPage(p); setSel(null); }}
        zoom={zoom}
        onZoom={setZoom}
        onFile={f => { void loadFile(f); }}
        onDemo={loadDemo}
        onSave={save}
        onReset={reset}
        blocking={blocking}
      />

      {notice && <div className={`notice ${notice.level}`}>{notice.text}</div>}

      <div className="toolbar2">
        <button className="btn" onClick={runDemoParse}>演示：用模板试解析</button>
        {demoLines && <button className="btn" onClick={() => { setDemoLines(null); hint('已关闭解析叠加'); }}>关闭叠加</button>}
        <span className="muted">
          {demoLines
            ? `叠加 ${demoLines.length} 个字段值 · 低置信 ${demoLines.filter(l => l.confidence < LOW_CONF).length} 个（红色）`
            : '用内置样例演示模板解析结果如何回贴到原页'}
        </span>
      </div>

      <div className="workspace">
        {sample ? (
          <Stage
            sample={sample}
            page={page}
            zoom={zoom}
            tool={tool}
            map={map}
            sel={sel}
            onDraw={draw}
            onSelect={setSel}
            onMove={moveRect}
            onHint={hint}
            demoLines={demoLines ?? undefined}
          />
        ) : (
          <div className="stage-wrap">
            <div className="empty">
              先载入一份样例流水（PDF / JPG / PNG），或点「示例页」用内置假数据练习。<br />
              样例只在本机读取，不会上传到服务器。
            </div>
          </div>
        )}

        <div className="side">
          <div className="side-scroll">
            <Inspector
              map={map}
              sel={sel}
              onBankCode={v => setMap(prev => ({ ...prev, bank_code: v }))}
              onKeywords={v => setMap(prev => ({ ...prev, match_rule: { ...prev.match_rule, bank_name_keywords: v } }))}
              onFingerprint={v => setMap(prev => ({ ...prev, match_rule: { ...prev.match_rule, header_fingerprint: v } }))}
              onAssign={assign}
              onHeaderY={y => setMap(prev => ({
                ...prev,
                tables: prev.tables.map(t => (sel?.kind === 'table' && t.id === sel.id ? { ...t, headerY: y } : t)),
              }))}
              onDelete={removeSelected}
              onAddCustom={f => setMap(prev => ({ ...prev, custom_fields: [...prev.custom_fields, f] }))}
              onRemoveCustom={code => setMap(prev => ({
                ...prev,
                custom_fields: prev.custom_fields.filter(c => c.code !== code),
                meta_boxes: prev.meta_boxes.map(b => (b.field === code ? { ...b, field: '' } : b)),
                tables: prev.tables.map(t => ({
                  ...t,
                  columns: t.columns.map(c => (c.field === code ? { ...c, field: '' } : c)),
                })),
              }))}
              onHint={hint}
            />
            <p className="muted" style={{ marginTop: 16 }}>
              试解析（dry-run）：<b>尚未接入后端</b>。现在只能做标注结构检查（T/W 码），
              抽取是否正确要等 <span className="mono">/templates/dry-run</span> 实现后才能验。
            </p>
          </div>
          <ValidationPanel
            issues={issues}
            onLocate={issue => {
              if (!issue.targetId) return;
              const asMeta = map.meta_boxes.find(b => b.id === issue.targetId);
              if (asMeta) { setSel({ kind: 'meta', id: asMeta.id }); setPage(asMeta.page); }
              const asTable = map.tables.find(t => t.id === issue.targetId);
              if (asTable) { setSel({ kind: 'table', id: asTable.id }); setPage(asTable.page); }
            }}
          />
        </div>
      </div>

      <div className="muted" style={{ padding: '6px 18px', background: '#fff', borderTop: '1px solid #e2e8f0' }}>
        样例：{sampleName || '未载入'} · 草稿自动保存在本机浏览器
      </div>
    </div>
  );
}

export function hasIssues(map: FieldMapV1): boolean {
  return hasBlockingError(validate(map, 1));
}
