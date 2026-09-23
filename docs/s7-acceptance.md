# S7 发布链路验收

开发与主要验收：2026-09-22；收尾：2026-09-23。Studio 发布功能完成；MusicBox 完整消费端兼容条件尚未满足。

## 实现与边界

- 发布绑定源资产与不可变 TTML revision，复用持久任务、幂等、重启中断和鉴权。普通自动化任务入口不能绕过专用发布入口。
- 发布前检查非空正文、完整且有限的时间、父子区间、媒体时长、draft null 与引用；合法重叠保留。服务端独立校验，浏览器提前使用编辑器最终导出校验给出反馈。
- 新增 `subt` handler、`stpp` sample entry、单 TTML sample。原位用同尺寸 free 替代旧 moov，追加新 sample 与新 moov，保持已有媒体 chunk offset 不变；采用流式文件复制和分块摘要。
- 回读比较完整新 moov、原媒体数据、音轨信息与元数据，逐字节比较 TTML。通过后才开放下载。发布记录标明旧版本、失败、中断和文件缺失；旧版本成品仍可下载。
- 页面按 AMLL TTML Tool 的紧凑分区交互组织：当前版本、发布操作、记录与展开报告。工作台未保存、保存中或冲突时先留在编辑器；发布页重新读取已保存版本。

当前范围是已有音轨的非分片 MP4/M4A；不转码其他格式。拒绝已有 subt/stpp 轨道、分片 MP4 和顶层 size=0 box。AAC、ALAC 已验证，其他 MP4 音频编码尚未专项验证。支持的是已理解的秒/毫秒/时钟时间 profile；未知时间语义不能通过最终发布。成品不承诺 faststart 布局，发布历史没有自动清理策略。没有新增公共部署或外部上传行为。

## 已执行验证

- `server/.venv/bin/pytest -q server/tests`：33 项通过。必要新增测试包括 AAC/ALAC × faststart/非 faststart 封装、TTML 回读和解码 PCM hash、无效 XML/已有 STPP 拒绝，以及真实 HTTP 发布/下载、幂等、旧修订、重启、文件缺失、无效绑定、后代 null 和下载鉴权。
- 前端类型生成、TypeScript 检查及 Vite 生产构建通过；Vitest 55 项通过。
- Chromium 既有浏览器回归 5 项通过。正常演示文档补齐时间，最终下载使用完整校验，不再只检查 XML 解析成功。
- 主 Agent 在真实 FastAPI + Vite 运行发布闭环：上传 4 秒合成 AAC/M4A，保存包含整体 Ruby、正文与 reading 时间、三歌手、合法重叠、非 BMP 字符的 TTML，生成、展开报告、下载；重启服务及刷新后记录和下载仍可用。
- 1440×900 与 390×844 无脚本错误、无横向溢出；窄屏状态保持单行，时间另起一行。[桌面](assets/s7/desktop.png)、[窄屏](assets/s7/mobile.png)、[浏览器记录](evidence/s7/browser.json)。
- 对浏览器实际下载产物重新提取 TTML，字节与修订完全一致；FFmpeg 5.1.8 解码源媒体和产物，PCM SHA-256 完全一致。[回读证据](evidence/s7/roundtrip.json)。

## 消费端结论

实际运行指定 MusicBox 版本的内嵌歌词提取函数：能识别媒体及 stpp 轨道，但返回的歌词为 null。该函数读取元数据歌词标签，尚无 STPP sample 提取路径。[版本、方法与证据](s7-musicbox-compatibility.md)。本次没有修改 MusicBox，未运行完整 Electron 播放器，因此不宣称 Ruby、word timing、多歌手动画或完整 S7 退出条件已通过。

## Git 增量

- `1ff16fc`：S7 范围与验收要求。
- `5e38e05`：MusicBox 读取兼容检查。
- `2102a6e`：媒体封装与回读。
- `814ed46`：持久发布任务、服务与契约。
- `4022462`：发布下载页面、必要前端测试和浏览器回归。
- `adbe649`：发布时钟语义与演示任务终态收尾。

代码由 gpt-5.6-luna 子代理实现，主 Agent 负责接口指导、逐批审查、实际回读与浏览器验收。
