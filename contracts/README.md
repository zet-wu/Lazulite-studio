# Contracts：前后端协议

[openapi.json](openapi.json) 已覆盖会话、能力、项目、上传、文档 GET/PUT、导入、歌词下载、媒体播放、波形和 PCM 片段、任务/SSE、读音词典、发布及成品下载。文档接口承载带 revision 的 TTML envelope，不再是 S1 的只读行摘要。

生成结果为 `frontend/src/adapters/http/generated.ts`；MSW 数据与 handlers 位于 `frontend/src/mocks`。修改接口时同步路由、契约、调用方与必要的行为验证。

当前已知缺口（2026-09-27 源码核对）：`server/review.py` 已实现 `GET/PATCH /projects/{id}/review`，前端 `http/review.ts` 已调用，但静态 OpenAPI 未列出该路径，使用手写类型。不能声称所有接口均已由契约生成或完成运行时校验；本轮只记录该差异，未修改协议代码。

接口语义与实现入口见[服务契约说明](../../lyric-workflow/docs/studio/reference/service-contract.md)。字段和状态码以实际路由及当前契约为依据，发现不一致应同时修正，不按历史草案新增兼容接口。

歌词获取接口为 POST `/lyric-sources/search`、`fetch`、`resolve`，打包选项来自 GET `/projects/{pid}/packaging`。PublishRequest 要求 revision、asset_id、lrc_kind、lrc_text，可选 target_track_id；静态契约与生成类型已同步。来源/包装响应在静态契约中仍使用宽对象，由手写 HTTP 适配器消费，不能视为完整响应校验。
