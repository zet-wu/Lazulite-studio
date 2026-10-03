# Contracts：前后端协议

[openapi.json](openapi.json) 已覆盖会话、能力、项目、上传、文档 GET/PUT、导入、歌词下载、媒体播放、波形和 PCM 片段、任务/SSE、读音词典、发布及成品下载。文档接口承载带 revision 的 studio-document-v3 envelope，document 是 studio-project-v1 JSON 快照，lyrics.draftTtml 为歌词交换边界，不再是 S1 的只读行摘要。

生成结果为 `frontend/src/adapters/http/generated.ts`；MSW 数据与 handlers 位于 `frontend/src/mocks`。修改接口时同步路由、契约、调用方与必要的行为验证。

当前已知缺口（2026-09-27 源码核对）：`server/review.py` 已实现 `GET/PATCH /projects/{id}/review`，前端 `http/review.ts` 已调用，但静态 OpenAPI 未列出该路径，使用手写类型。不能声称所有接口均已由契约生成或完成运行时校验；本轮只记录该差异，未修改协议代码。

接口语义与实现入口见[服务契约说明](../../lyric-workflow/docs/studio/reference/service-contract.md)。字段和状态码以实际路由及当前契约为依据，发现不一致应同时修正，不按历史草案新增兼容接口。

歌词获取接口为 POST `/lyric-sources/search`、`fetch`、`resolve`，打包选项来自 GET `/projects/{pid}/packaging`。PublishRequest 要求 revision、asset_id、lrc_kind、lrc_text，可选 target_track_id；静态契约与生成类型已同步。来源/包装响应在静态契约中仍使用宽对象，由手写 HTTP 适配器消费，不能视为完整响应校验。

人声结果列表、能量窗口与 FLAC 下载已列入静态契约；VocalResult、VocalEnergyWindow 由生成类型消费。vocal 任务参数只需资产，可选 retry_analysis_id 复用 separated/ready 人声，每次以任务 ID 创建独立结果并保留旧文件，模型/设备由服务配置；歌词任务仍需 revision。媒体 audio/waveform/pcm 的 vocal 参数选用已注册人声，省略时使用原曲。静态契约不等于所有响应均有运行时校验。

日文注音快照接口 `/api/v1/reading/analyze` 使用 ReadingSnapshot/ReadingAnalysis，稳定行 ID 与 code point 范围不依赖项目修订；空读音表示待处理或无需注音区间，由前端按原文识别汉字缺失项。

ReadingAnalysis.ranges 可返回比 Sudachi C token 更细的可靠片段，仍是原始 code point 范围。范围不等于用户正文词，也不要求前端照其边界拆词；前端先做假名锚点再投影。字段结构不变。
