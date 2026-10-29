import type { SamplePage } from './types';

/** 内置示例页：没有样例文件时也能演示框选。内容全为假数据。 */
export function createDemoPage(): SamplePage {
  const W = 1240;
  const H = 1754;
  const img = new Image();
  img.src = drawDemo(W, H);

  return {
    pageCount: 1,
    width: W,
    height: H,
    async render(_pageNo, target, maxWidth) {
      const scale = maxWidth / W;
      target.width = Math.round(W * scale);
      target.height = Math.round(H * scale);
      const ctx = target.getContext('2d');
      if (!ctx) throw new Error('浏览器不支持画布绘制');
      if (!img.complete) await img.decode().catch(() => undefined);
      ctx.drawImage(img, 0, 0, target.width, target.height);
    },
    dispose() { img.src = ''; },
  };
}

function drawDemo(W: number, H: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('示例银行 个人账户交易明细', 90, 110);
  ctx.font = '20px sans-serif';
  ctx.fillText('账号：6222 **** **** 1234　　户名：张*　　期间：2026-04-01 至 2026-09-30', 90, 175);
  ctx.fillText('打印时间：2026-10-01　　第 1 页 / 共 1 页', 90, 210);

  const cols = [
    { label: '交易日期', x: 90, w: 170 },
    { label: '摘要', x: 260, w: 360 },
    { label: '对方户名', x: 620, w: 210 },
    { label: '发生额', x: 830, w: 150 },
    { label: '余额', x: 980, w: 170 },
  ];
  const top = 280;
  const rowH = 44;

  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(90, top, 1060, rowH);
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 20px sans-serif';
  cols.forEach(c => ctx.fillText(c.label, c.x + 8, top + 29));

  const rows = [
    ['2026-04-05', '工资代发', '某某科技有限公司', '+12,800.00', '23,451.20'],
    ['2026-04-08', '超市消费', '某某连锁超市', '-236.50', '23,214.70'],
    ['2026-04-12', '转账', '李*', '-3,000.00', '20,214.70'],
    ['2026-05-05', '工资代发', '某某科技有限公司', '+12,800.00', '33,014.70'],
    ['2026-05-09', '信用卡还款', '某某银行信用卡', '-4,200.00', '28,814.70'],
    ['2026-05-20', '利息', '结息', '+18.42', '28,833.12'],
    ['2026-06-05', '工资代发', '某某科技有限公司', '+12,800.00', '41,633.12'],
    ['2026-06-15', '取现', 'ATM', '-2,000.00', '39,633.12'],
  ];

  ctx.font = '19px sans-serif';
  rows.forEach((r, i) => {
    const y = top + rowH * (i + 1);
    if (i % 2 === 1) { ctx.fillStyle = '#fafafa'; ctx.fillRect(90, y, 1060, rowH); }
    ctx.fillStyle = '#111827';
    r.forEach((cell, j) => {
      const c = cols[j];
      const right = c.label === '发生额' || c.label === '余额';
      if (right) {
        const tw = ctx.measureText(cell).width;
        ctx.fillText(cell, c.x + c.w - tw - 10, y + 29);
      } else {
        ctx.fillText(cell, c.x + 8, y + 29);
      }
    });
  });

  const bottom = top + rowH * (rows.length + 1);
  ctx.strokeStyle = '#d1d5db';
  ctx.beginPath();
  ctx.moveTo(90, bottom + 30);
  ctx.lineTo(1150, bottom + 30);
  ctx.stroke();
  ctx.font = '19px sans-serif';
  ctx.fillText('合计收入：38,418.42　　合计支出：9,436.50', 90, bottom + 70);

  return canvas.toDataURL('image/png');
}
