import { ApiError } from './errors';
import { clearSession, getToken } from '../auth/store';

const BASE = '/api/v1';

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * 唯一的请求出口：base、token、错误码、超时都收在这里。
 *
 * 合并前端之前这套逻辑有三份（两个 SPA + 三个静态页各写一遍），
 * 错误码文案甚至已经不一致；现在只允许从这里发请求。
 */
export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
  const token = getToken();

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(BASE + path, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: options.signal ?? controller.signal,
    });

    if (response.status === 401) {
      clearSession();
      throw new ApiError('E_AUTH', '登录已过期', { httpStatus: 401 });
    }

    const text = await response.text();
    const payload = text ? safeJson(text) : null;

    if (!response.ok) {
      const detail = (payload as { detail?: { code?: string; message?: string } } | null)?.detail;
      throw new ApiError(detail?.code ?? 'E_UNKNOWN', detail?.message ?? response.statusText, {
        httpStatus: response.status,
        detail: payload,
      });
    }

    // 两种出参形状并存：银行侧接口直接返回对象，借款侧接口外面套了一层 {code, data}。
    // 合并前是两个客户端各处理各的，这里统一收口，页面不必关心。
    const envelope = payload as { code?: unknown; data?: unknown; message?: string } | null;
    if (envelope && typeof envelope === 'object' && 'code' in envelope && 'data' in envelope) {
      if (String(envelope.code) !== '0') {
        throw new ApiError(String(envelope.code), envelope.message ?? '请求失败', { detail: payload });
      }
      return envelope.data as T;
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as Error)?.name === 'AbortError') {
      throw new ApiError('E_NETWORK', '请求超时');
    }
    throw new ApiError('E_NETWORK', '网络连接失败');
  } finally {
    clearTimeout(timeout);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
