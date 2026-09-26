# 设计索引

编辑器执行入口：[歌词编辑器重构与 AMLL TTML Tool 对齐计划](lyric-editor-implementation-plan.md)；E0–E7 的操作证据与仍需外部验证的差异见[E7 验收](editor-e7-acceptance.md)和[对齐矩阵](editor-parity.md)。编辑器布局、模型与旧数据兼容策略以计划及根目录 [AGENTS.md](../AGENTS.md) 为准；以下 S1–S7 文档保留为历史记录。

本仓库维护新编辑器计划与各阶段验收；并列工作流仓库维护总体衔接与现状摘要：

- [前端架构](../../lyric-workflow/docs/lazulite_studio_frontend_architecture.md)
- [服务契约](../../lyric-workflow/docs/lazulite_studio_service_contract.md)
- [实施与验收](../../lyric-workflow/docs/lazulite_studio_implementation_plan.md)

当前实现边界（新编辑器模型按上述计划重构）：

1. 富歌词模型与 TTML 保留树构成编辑基础，保真验证先于真实编辑开放。
2. 所有歌词修改走可撤销的领域事务；机器结果必须人工应用。
3. 草稿保存采用 revision/ETag；旧任务结果和后台请求不覆盖 dirty 文档。
4. 媒体、项目、任务和模型在服务端管理，前端按能力发现开放功能。
5. 任意数量 agent 从第一版模型支持，Ruby/细粒度数据从导入开始保留。

后续在本仓库记录实施决策与验证证据，不将新计划全文复制到工作流仓库。本次 S1 开发与校验见 [验收记录](s1-acceptance.md)，TTML 前置试验见 [profile 记录](ttml-profile-probe.md)。

现有 S1–S6 均有实施与验收记录；S7 Studio 发布部分已完成，完整消费端条件未满足。S3 项目与媒体范围见 [实施记录](s3-implementation.md)，真实服务、媒体时间和浏览器检查见 [验收记录](s3-acceptance.md)。S2 的本地 TTML、可逆命令与检查点边界见 [实施记录](s2-implementation.md)，测试与浏览器证据见 [验收记录](s2-acceptance.md)。运行与开发命令见 [frontend](../frontend/README.md)，依赖许可见 [记录](dependency-licenses.md)。

S4 行级制作范围与传输决策见 [实施记录](s4-implementation.md)，真实浏览器闭环、合成后端边界和性能测量见 [验收记录](s4-acceptance.md)。

S5 日语整体 Ruby、读音候选、确认与用户词典的开发边界见 [实施记录](s5-implementation.md)，实际范围与验证结果见 [验收记录](s5-acceptance.md)。

S6 细粒度时间、行拆合、组合歌手与实验 forced 对齐见 [实施记录](s6-implementation.md)，验证结果和性能边界见 [验收记录](s6-acceptance.md)。

S7 媒体封装、持久发布与下载见 [实施记录](s7-implementation.md)和[验收记录](s7-acceptance.md)。[MusicBox 检查](s7-musicbox-compatibility.md)确认当前消费端尚缺 STPP sample 提取，不能将本阶段标记为完整消费端兼容。
