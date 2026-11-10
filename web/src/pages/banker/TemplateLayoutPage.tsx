import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTemplateLayout, type TemplateLayout } from '../../api/banker';
import { getErrorMessage } from '../../api/errors';
import { Notice } from '../../ui/Notice';

/**
 * 版式回看。
 *
 * 只显示当前有效的结构：tables[].columns[]（归一化 0-1 的列带）。
 * 旧版还有 boxes 字段，那是历史格式，读它会得到「框永远是空的」——
 * 封存版就是在这里踩过坑，这里不读它。
 */
export default function TemplateLayoutPage() {
  const { id } = useParams();
  const templateId = Number(id);
  const [data, setData] = useState<TemplateLayout | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getTemplateLayout(templateId)
      .then(setData)
      .catch((err) => setError(getErrorMessage(err, 'banker')));
  }, [templateId]);

  if (error) {
    return (
      <div className="panel">
        <Notice>{error}</Notice>
        <Link className="btn btn-ghost" to="/bank/templates">回到列表</Link>
      </div>
    );
  }
  if (!data) return <p className="muted">加载中…</p>;

  const pages = data.layout?.pages ?? {};
  const boxes = data.layout?.boxes ?? [];

  return (
    <div className="panel wide">
      <header className="panel-head">
        <div>
          <h1>版式回看</h1>
          <p className="sub">
            模板 #{data.template_id} · {data.has_sample ? '有样本' : '无样本'} · {data.layout?.page_count ?? 0} 页
          </p>
        </div>
        <Link className="btn btn-ghost" to={'/bank/templates/' + data.template_id}>回到详情</Link>
      </header>

      {Object.keys(pages).length ? (
        <table className="grid compact">
          <thead><tr><th>页</th><th>页面尺寸</th></tr></thead>
          <tbody>
            {Object.entries(pages).map(([page, size]) => (
              <tr key={page}><td>{page}</td><td className="small muted">{Math.round(size.width)} × {Math.round(size.height)} pt</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h2>框（{boxes.length} 个）</h2>
      {boxes.length ? (
        <table className="grid compact">
          <thead><tr><th>字段</th><th>列</th><th>页</th><th>范围</th></tr></thead>
          <tbody>
            {boxes.map((box, index) => (
              <tr key={index}>
                <td>{box.field}</td>
                <td className="small muted">{box.column}</td>
                <td>{box.page + 1}</td>
                <td className="small muted">
                  x {box.x0.toFixed(3)}–{box.x1.toFixed(3)} · y {box.y0.toFixed(3)}–{box.y1.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">这份模板没有可回看的框（旧格式或未保存框选）。</p>
      )}
    </div>
  );
}
