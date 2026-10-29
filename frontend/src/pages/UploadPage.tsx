import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

const MB = 1024 * 1024;

export function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [agreed, setAgreed] = useState(false);
  const selection = useRef(0);

  async function selectFile(candidate?: File) {
    const current = ++selection.current;
    setFile(null);
    setError('');
    setChecking(false);
    if (!candidate) return;

    setChecking(true);
    try {
      const isPdf = candidate.type === 'application/pdf'
        && /\.pdf$/i.test(candidate.name);
      const isImage = ['image/jpeg', 'image/png'].includes(candidate.type)
        && /\.(jpe?g|png)$/i.test(candidate.name);

      if (!isPdf && !isImage) {
        throw new Error('仅支持 PDF、JPG、JPEG、PNG 文件。');
      }
      if (candidate.size === 0) {
        throw new Error('文件为空，请重新选择。');
      }
      if (candidate.size > (isPdf ? 20 : 10) * MB) {
        throw new Error(isPdf ? 'PDF 不能超过 20MB。' : '图片不能超过 10MB。');
      }

      if (isImage) {
        let image: ImageBitmap;
        try {
          image = await createImageBitmap(candidate);
        } catch {
          throw new Error('图片无法读取，请重新导出或选择其他文件。');
        }
        const shortSide = Math.min(image.width, image.height);
        image.close();
        if (shortSide < 1000) {
          throw new Error('图片短边不足 1000 像素，请重新拍摄或导出。');
        }
      }

      if (selection.current === current) setFile(candidate);
    } catch (cause) {
      if (selection.current === current) {
        setError(cause instanceof Error ? cause.message : '文件检查失败，请重试。');
      }
    } finally {
      if (selection.current === current) setChecking(false);
    }
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.dataTransfer.files.length !== 1) {
      void selectFile();
      setError('本页每次选择一份材料，请勿同时拖入多个文件。');
      return;
    }
    void selectFile(event.dataTransfer.files[0]);
  }

  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    void selectFile(event.target.files?.[0]);
    event.target.value = '';
  }

  const periodError = start && end && start > end
    ? '开始月份不能晚于结束月份。'
    : '';

  return (
    <>
      <header className="top">
        <div className="wrap nav-wrap">
          <span className="brand">
            <span className="mark" aria-hidden="true">◈</span>
            银行流水材料提交
          </span>
        </div>
      </header>

      <main className="shell">
        <h1 className="page-title">上传个人银行流水</h1>
        <p className="desc">提交授权范围内的材料，供银行处理。</p>

        <aside className="notice" role="note">
          当前为上传页面预览：文件只在本地检查，不会发送至服务器。
          登录、上传接口和任务进度尚未接入。
        </aside>

        <section className="panel">
          <h2>选择材料</h2>
          <ul className="material-help">
            <li>电子 PDF：推荐从手机银行直接导出，最大 20MB。</li>
            <li>拍照或扫描图片：JPG/PNG，最大 10MB，短边至少 1000 像素；处理后需人工复核。</li>
            <li>截图：可以选择，但来源难以核验，可能无法作为授信依据。</li>
          </ul>
          <p className="muted">
            实际载体类型、清晰度和文件完整性以后端检查为准。
          </p>

          <div
            className="drop"
            onDragOver={event => event.preventDefault()}
            onDrop={dropFile}
          >
            <h3>拖拽一份文件到这里</h3>
            <label className="btn ghost">
              选择文件
              <input
                className="file-input"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={changeFile}
              />
            </label>
            <p>支持 PDF / JPG / JPEG / PNG</p>
          </div>

          <div aria-live="polite">
            {checking && <p>正在检查文件…</p>}
            {file && (
              <div className="file-row">
                <strong>{file.name}</strong>
                <span>本地检查通过，尚未上传</span>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => { void selectFile(); }}
                >
                  移除
                </button>
              </div>
            )}
            {error && <p className="error" role="alert">{error}</p>}
          </div>

          <div className="controls">
            <label>
              开始月份
              <input
                type="month"
                value={start}
                max={end || undefined}
                onChange={event => setStart(event.target.value)}
              />
            </label>
            <label>
              结束月份
              <input
                type="month"
                value={end}
                min={start || undefined}
                onChange={event => setEnd(event.target.value)}
              />
            </label>
          </div>

          {periodError && <p className="error" role="alert">{periodError}</p>}

          <label className="consent consent-row">
            <input
              type="checkbox"
              checked={agreed}
              onChange={event => setAgreed(event.target.checked)}
            />
            我确认已获授权提交该流水，并同意由银行按授权用途处理。
          </label>

          <button className="btn" type="button" disabled>
            上传接口待接入
          </button>
          <p className="muted">
            接入后将由服务端完成身份校验、文件受理和任务创建。
          </p>
        </section>
      </main>
    </>
  );
}
