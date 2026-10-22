# Contracts：前后端协议

[openapi.json](openapi.json) 描述 `/api/v1` 会话、能力、项目、上传、文档、媒体窗口、任务状态、读音、对齐、人声、发布、工程归档与空间统计。生成类型位于 `frontend/src/adapters/http/generated.ts`，MSW 位于 `frontend/src/mocks`。

在仓库根目录运行 `pnpm --dir frontend contracts:generate` 更新类型。接口修改同步路由、契约与调用方；来源和打包等部分响应使用宽对象，运行时校验由相应 HTTP 适配器负责。

| 接口组 | 主要边界 |
| --- | --- |
| 文档 GET／PUT | GET 返回 `studio-document-v9` envelope 与项目 v9；PUT 使用 If-Match／幂等键，成功只返回 revision／ETag；歌词为 `lyrics.draftTtml` |
| 上传与项目音乐 | 临时 upload_id 经创建或首次接入归属项目，项目 asset 是音源身份 |
| audio／waveform／pcm | 整数毫秒窗口；可选 vocal 选择已注册人声，默认原曲 |
| reading/analyze | 当前行 id／text 快照，返回原文 code point 范围及读音 |
| reading/dictionaries | 列表、ZIP 导入检查／安装、显式替换和移除；来源及安装实例随响应提供 |
| reading/dictionaries/{id}/analyze | 安装实例与行文本快照，返回 code point 范围、固定读音单元及缺词／歧义状态；过期实例返回 409；`stream=true` 返回 NDJSON 阶段、结果或错误 |
| alignment-preview／jobs/alignment | 已保存 revision、提示及结果策略；scope 与目标映射用于完整性核对 |
| 人声结果／能量／下载 | 分析 ID 与音频所有者 ID 分开，复用任务可返回已有 analysis_id |
| 发布 | revision、asset_id、lrc_kind、lrc_text 和可选 target_track_id；MP4/M4A 的 none + null 保留已有歌词标签，lrc／elrc 提供非空文本；通过回读报告后下载 |
| embedded-lyrics | 项目源音频候选，返回内容／格式或候选错误 |
| archive／project-archives | `.lazp` ZIP，manifest v1、项目 v9、可选一份源音频，导入创建独立项目 |
| source-metadata | 当前源音频 asset_id 与搜索条件三字段；读取与保存条件分别提交 |
| storage | total_bytes、五类 categories、measured_at，按项目目录逻辑字节统计 |

项目 editing 保存空拍、忽略行、跳过对齐和行尾链接，karaoke 保存导唱及输出配置；服务在保存边界验证身份、类型、范围和引用。普通 TTML 与 STPP 共用歌词规则；媒体边界负责源资产、容器和写入回读。

会话与写请求使用精确来源匹配，密码模式结合会话 cookie、CSRF cookie 和 `X-CSRF-Token`。能力由实际配置和运行依赖决定。整体实现见[服务端架构](../server/README.md)。

文档和任务以 revision 标识保存快照；发布报告返回实际回读结论。源资源 SHA-256 作为资产身份，工程 manifest 保留源音频摘要。
