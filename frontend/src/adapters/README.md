# Adapters：外部系统与格式

当前实现：

- `http/`：项目/媒体、文档保存、任务/SSE、读音/词典、复核和发布接口。生成类型来自 OpenAPI，部分接口另有手写类型；当前契约缺口见[契约说明](../../../contracts/README.md)。
- `ttml/`：XML 解析、保留树、profile、简单 span/整体 Ruby/细粒度时间、结构写回和候选映射。可理解内容开放编辑，未知结构仍按字段限制。
- `recovery/`：IndexedDB 检查点，保存编辑状态及有限历史。项目工作区同时保存 base revision；本地编辑使用文档身份区分检查点。

媒体服务请求已经接入，播放时钟与交互在 `features/MediaTransport.tsx`，并不存在独立 Media adapter 目录。AMLL 预览适配器尚未实现。

适配器不决定用户是否接受机器结果。[下一阶段](../../../docs/lyric-editor-implementation-plan.md)重构 TTML 映射和恢复格式，直接切换当前模型，不添加旧版本回退。
