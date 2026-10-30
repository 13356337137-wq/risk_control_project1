import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

export type ArchiveOutcome =
  | { status: 'ok'; name: string; blob: Blob; others: number }
  | { status: 'need-password'; name: string }
  | { status: 'wrong-password'; name: string };

export class ArchiveError extends Error {
  constructor(message: string) { super(message); this.name = 'ArchiveError'; }
}

const ACCEPTED = /\.(pdf|jpe?g|png)$/i;
const MAX_UNCOMPRESSED = 200 * 1024 * 1024;

/**
 * 读取加密压缩包里的受理材料。
 * 业务口径：招行/工行导出的流水常为带口令的 zip，口令多为身份证后六位或手机号后六位。
 * 无口令时只读取目录清单（不解压），避免把「缺口令」误报成「文件损坏」。
 */
export async function extractStatement(file: File, password?: string): Promise<ArchiveOutcome> {
  const reader = new ZipReader(new BlobReader(file), password ? { password } : undefined);
  try {
    let entries;
    try {
      entries = await reader.getEntries();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not recognized|corrupt|invalid/i.test(msg)) {
        throw new ArchiveError('这不是有效的压缩包，或文件已损坏，请让客户重新导出');
      }
      throw new ArchiveError(`压缩包打不开：${msg}`);
    }
    const files = entries.filter(e => !e.directory);
    if (files.length === 0) throw new ArchiveError('压缩包是空的');

    const total = files.reduce((n, e) => n + (e.uncompressedSize ?? 0), 0);
    if (total > MAX_UNCOMPRESSED) throw new ArchiveError('解压后体积超过 200MB，已停止（防止压缩炸弹）');

    const target = files.find(e => ACCEPTED.test(e.filename));
    if (!target) throw new ArchiveError('压缩包里没有可受理的 PDF 或图片，请确认是否选错了文件');

    if (target.encrypted && !password) {
      return { status: 'need-password', name: target.filename };
    }

    try {
      const blob = await target.getData(new BlobWriter());
      return { status: 'ok', name: target.filename, blob, others: files.length - 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/password/i.test(msg)) return { status: 'wrong-password', name: target.filename };
      throw new ArchiveError(`压缩包解压失败：${msg}`);
    }
  } finally {
    await reader.close().catch(() => undefined);
  }
}

export function isArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}