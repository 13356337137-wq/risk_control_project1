import { useEffect, useRef, useState } from 'react';

export interface PasswordRequest {
  target: string;
  kind: 'zip' | 'pdf';
  wrong: boolean;
  attempts: number;
  maxAttempts: number;
}

interface Props {
  request: PasswordRequest;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordDialog({ request, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.wrong, request.attempts, request.target]);

  const hint = request.kind === 'zip'
    ? '银行导出的流水常打包成加密压缩包，口令一般是身份证后六位或手机号后六位。'
    : '该 PDF 自带打开口令，需要客户提供。';
  const left = request.maxAttempts - request.attempts;

  return (
    <div className="modal-mask" role="dialog" aria-modal="true" aria-label="输入材料口令">
      <div className="modal">
        <h3>这份材料需要口令</h3>
        <p className="muted">{request.target}</p>
        <p className="hint-box">{hint}</p>

        {request.wrong && (
          <p className="error-box" role="alert">
            口令不对。还可以尝试 {left} 次{left === 0 ? '，本次将放弃并提示客户重新提交' : '。'}
          </p>
        )}

        <label className="field">
          口令
          <input
            ref={inputRef}
            type="password"
            value={value}
            autoComplete="off"
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && value) onSubmit(value); }}
          />
        </label>
        <p className="muted small">口令只在本机内存中用于打开文件，不上传、不保存。</p>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn primary" disabled={!value} onClick={() => onSubmit(value)}>
            用这个口令打开
          </button>
        </div>
      </div>
    </div>
  );
}
