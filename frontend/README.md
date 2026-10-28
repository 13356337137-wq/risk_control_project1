# 前端

## 用途
借款人侧个人银行流水上传页面。当前只完成工程底座和本地文件检查。
不展示评分、风险等级、报告、指标或算法结果。

## 启动与验证
在 frontend 目录运行：
npm.cmd install
npm.cmd run build
npm.cmd run dev

浏览器访问 http://localhost:5173。
Windows PowerShell 使用 npm.cmd；其他终端可使用 npm。

## 当前范围
支持单文件选择或拖拽、非空及类型检查、PDF 20MB、图片 10MB、
图片短边至少 1000px、期间输入与授权勾选。
文件不会上传，未实现身份认证、真实提交、进度轮询和银行侧应用。
图片清晰度、实际载体和完整性由服务端判定，前端不作判断。
