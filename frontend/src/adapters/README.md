# Adapters：格式、HTTP 与本地恢复

适配器层负责外部文件格式转换、服务端 HTTP 通信、长期偏好同步与浏览器本地恢复，将外部输入转换为 `domain` 可直接处理的强类型数据。

## TTML 与项目快照

- `ttml/lyric-codec.ts`：解析与序列化 Studio TTML（含正文、注音、背景行、歌手与 `actorRef`、翻译/音译轨道、不雅用语及支持的 Apple/AMLL 扩展）。草稿序列化保留内部身份与未定时间，正式导出清除内部属性。
- `project-codec.ts`：读写项目 JSON v9（`lyrics.draftTtml`、`editing`、`acoustics`、`amll`、`lineOrder`、`karaoke`）。
- `recovery/index.ts`：复用单一 IndexedDB 连接读写 `recovery-v11` 本地恢复点（含当前项目、基础修订与源音频身份），读盘校验通过后以空撤销历史恢复。

## 歌词格式与卡拉 OK 输出

- `lyric-formats.ts`、`source-codec.ts`、`lrc.ts`、`ass.ts`、`sug-import.ts`、`sug-timing.ts`：处理纯文本、LRC / 扩展 LRC / ESLRC / QRC / YRC / LYS、KRC 导入、ASS 导出与单个 SUG 0.3.0 文件导入。`export-separators.ts` 保留空白分隔并按格式能力输出。
- `karaoke-output.ts`、`nicokara.ts`、`sug.ts`、`sug-singers.ts`：共享分组与附属轨道输出编号、跨平台文件名与 ZIP 打包。`nicokara.ts` 输出 `.kra`（厘秒时间、注音标签、歌手触发串与透明占位图），`sug.ts` 输出 SUG 0.3.0 JSON（毫秒时间、导唱符与按输出映射合并的歌手名称）。
- `lyric-output.ts`、`output-validation.ts`、`format-description.ts`：统一生成各格式内容投影、阻塞与警告问题列表（按稳定对象 ID 定位）及格式说明。

## HTTP 与偏好

- `http/client.ts`：提供统一的 `apiFetch` / `apiJson` 基础封装、会话、CSRF 与错误解析；`generated.ts` 由 `contracts/openapi.json` 自动生成，`validate.ts` 承担必要的响应边界检查。
- 其余 `http/*.ts` 模块按业务封装任务、读音、词典、对齐、字形、在线歌词源、打包直下与媒体租约调用。
- `preferences.ts` 与 `project-lifecycle.ts`：将长期偏好映射到服务端 `/settings`（带 `If-Match` 并发检查），并按库 ID 隔离本地恢复与跨标签页项目变更通知。
