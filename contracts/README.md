# Contracts：前后端协议

[openapi.json](openapi.json) 已覆盖会话、能力、项目、上传、文档 GET/PUT、导入、歌词下载、媒体播放、波形和 PCM 片段、内部任务/SSE、全局自动对齐、主动注音、发布及成品下载。文档接口承载带 revision 的 studio-document-v9 envelope，document 是 studio-project-v7 JSON 快照，lyrics.draftTtml 为歌词交换边界，不再是 S1 的只读行摘要。

生成结果为 `frontend/src/adapters/http/generated.ts`；MSW 数据与 handlers 位于 `frontend/src/mocks`。修改接口时同步路由、契约、调用方与必要的行为验证。


接口语义与实现入口见[服务契约说明](../../lyric-workflow/docs/studio/reference/service-contract.md)。字段和状态码以实际路由及当前契约为依据，发现不一致应同时修正，不按历史草案新增兼容接口。

歌词获取接口为 POST `/lyric-sources/search`、`fetch`、`resolve`，打包选项来自 GET `/projects/{pid}/packaging`。PublishRequest 要求 revision、asset_id、lrc_kind、lrc_text，可选 target_track_id；静态契约与生成类型已同步。来源/包装响应在静态契约中仍使用宽对象，由手写 HTTP 适配器消费，不能视为完整响应校验。

人声结果列表、能量窗口与 WAV 下载已列入静态契约；VocalResult、VocalEnergyWindow 由生成类型消费。vocal 任务参数只需资产，可选 retry_analysis_id 复用 separated/ready 人声，每次以任务 ID 创建独立结果并保留旧文件，模型/设备由服务配置；歌词任务仍需 revision。媒体 audio/waveform/pcm 的 vocal 参数选用已注册人声，省略时使用原曲。静态契约不等于所有响应均有运行时校验。

日文注音快照接口 `/api/v1/reading/analyze` 使用 ReadingSnapshot/ReadingAnalysis，稳定行 ID 与 code point 范围不依赖项目修订；空读音表示待处理或无需注音区间，由前端按原文识别汉字缺失项。

ReadingAnalysis.ranges 可返回比 Sudachi C token 更细的可靠片段，仍是原始 code point 范围。范围不等于用户正文词，也不要求前端照其边界拆词；前端先做假名锚点再投影。字段结构不变。

项目 `editing` 保存词／Ruby 非零空拍计数、忽略行 ID、行尾链接映射；三类配置不写入 draftTtml。服务端在读取与保存边界验证引用、类别、范围、重复 ID 与链接的已求值端点。旧快照不转换。

创建项目只要求 name，可选 upload_id；POST /uploads 返回独立临时资源 ID，DELETE /uploads/{token} 取消已完成临时上传，POST /projects/{id}/music 首次接入。歌词快照不含 sourceAssetId，项目接口的 asset 为资源权威，无音乐返回 null。无音乐拒绝音频接口及媒体发布，纯歌词保存和下载可用。

`GET /projects/{projectId}/embedded-lyrics` 为只读原始音频歌词候选接口，返回 asset_id 与 candidates。每项含 id、label，以及 content/format 或 error；服务确认项目资源归属，不接收客户端路径。

人声输入直接解码为 44.1 kHz 双声道 float32；持久音频策略 v2 为单份 PCM_16 WAV，分析从此文件重读，播放／PCM／波形绕过原曲 48 kHz 代理，下载返回同一文件。旧策略结果不可复用，不迁移或删除旧文件；用户需明确重新分离，原歌词和片段保留。

`GET /projects/{projectId}/archive` 返回已保存快照的 `.lazp`；`POST /project-archives` 接受 multipart file 并创建独立项目。ZIP 内固定 `manifest.json`、`project.json` 和可选 `media/source.<扩展名>`；manifest 版本 1，项目模型继续使用 v7。导入不采用来源分析身份，不生成分析任务。

`GET /projects/{projectId}/storage` 返回 `ProjectStorage`：`total_bytes`、五类 `categories` 及 `measured_at`。数值为项目目录实际逻辑字节，分类之和等于总量；统计失败返回 503，不返回伪造零值。
