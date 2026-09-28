# Adapters：外部系统与格式

当前实现：

- `http/`：项目/媒体、文档保存、任务/SSE、读音/词典、复核和发布接口。生成类型来自 OpenAPI，部分接口另有手写类型；当前契约缺口见[契约说明](../../../contracts/README.md)。
- `ttml/`：`lyric-codec.ts` 将 XML 转为 v5 语义文档并重新生成 TTML；支持词/Ruby、背景和有序文档级音译轨道，已兼容 AMLL 无命名空间子节点和绝对分钟时间。旧保留树 codec 已移除，未知不支持结构报错。
- `recovery/`：IndexedDB 检查点，保存编辑状态及有限历史。项目工作区同时保存 base revision；本地编辑使用文档身份区分检查点。

媒体服务请求已经接入，播放时钟与交互在 `features/MediaTransport.tsx`；PCM 窗口由频谱 Worker 按需读取。`lyric-formats.ts` 用参考工具同版本格式库解析/生成 LRC、ESLRC、QRC、YRC、LYS 和 ASS；AMLL 预览投影在 `domain/preview-adapter.ts`，不回写语义文档。

适配器不决定用户是否接受机器结果。音译使用有序文档轨道；AMLL 的逐词音译仅为预览时的临时投影。后续交互整改见[Phase 3 方案](../../../../lyric-workflow/docs/studio/plans/phase3-timeline-layout-remediation.md)。
