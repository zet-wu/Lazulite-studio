# Contracts：前后端接口契约

[openapi.json](openapi.json) 定义服务端 `/api/v1` 的全部 HTTP 接口，前端类型通过以下命令自动生成到 `frontend/src/adapters/http/generated.ts`：

```sh
pnpm --dir frontend contracts:generate
```

修改后端接口时，请同步更新 `openapi.json`、生成类型以及 `frontend/src/mocks` 中的开发模拟数据。

## 主要接口分组

| 分组 | 说明 |
| --- | --- |
| 会话与设置 | 密码登录/登出、能力探测、`GET/PATCH /settings`（`If-Match` 逐字段更新） |
| 项目与音频 | 项目增删查、音频/视频分块上传与音源替换、源音频元数据标签（`source-metadata`）、空间统计（`storage`） |
| 文档与修订 | `GET/PUT /projects/{pid}/document`（`studio-document-v9` 与 `studio-project-v9`，保存使用 `If-Match` 与幂等键） |
| 媒体与租约 | `audio`（Range 流）、`waveform`（多级峰值）、`pcm`（声谱图窗口）、`audio-excerpt`（最多 30 秒的 16 kHz 单声道 WAV 听审窗口）、`media-users/{page_id}`（页面内存租约） |
| 歌词与语言工具 | 在线歌词搜索、源音频内嵌歌词（`embedded-lyrics`）、日文读音与助词（`reading/*`）、固定词典管理与注音、字形转换（`shapes/analyze`） |
| 任务、人声与对齐 | 统一任务查询/取消/CPU 重试、人声分离/上传/能量/下载、模型目录管理与自动对齐预览/启动 |
| 媒体打包与归档 | 打包信息查询与无持久化直下（`packaging`、`packaging/download`）、`.lazp` 工程导入导出 |

## 通用约定

- 密码模式通过会话 Cookie 与 `X-CSRF-Token` 保护写操作；本机便携模式与受信网关模式免密码进入。
- `Asset.source_duration_ms` 表示源音频探测时长（用于校验歌词时间是否超界），`Asset.duration_ms` 表示播放代理时长（用于播放定位与媒体读取）。
- 服务端具体实现与锁边界见 [服务端架构](../server/README.md)。
