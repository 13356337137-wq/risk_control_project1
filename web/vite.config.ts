import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 合并后的单页应用：base 固定为根路径，三端用客户端路由区分。
// 开发期把 /api 代理到后端 8010，避免 CORS 与 cookie 域问题。
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    // 特征 Lab 是新平台的独立服务（8020），其余接口仍在旧后端（8010）。
    // 更具体的路径必须排在前面，否则会被 '/api' 先吃掉。
    proxy: {
      '/api/v1/lab': process.env.LAB_TARGET || 'http://127.0.0.1:8020',
      '/api': process.env.API_TARGET || 'http://127.0.0.1:8010',
    },
  },
});
