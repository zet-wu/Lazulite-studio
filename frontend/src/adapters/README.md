# Adapters：格式、运行时与持久化

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

## 浏览器 Demo 运行时

- `runtime.ts`：`VITE_STUDIO_RUNTIME=browser` 选择本地运行时，默认 HTTP 构建输出 `dist/`，`build:demo` 输出 `dist-demo/`；`VITE_DESKTOP_DOWNLOAD_URL` 与 `VITE_SITE_URL` 指定下载和介绍站外链。
- `browser/db.ts`：独立 `lazulite-studio-browser-v1` 数据库的 projects／documents／assets；快照沿用项目 v9 与修订冲突协议，同事务保存与音源绑定。Blob 写入配额不足时保留会话音频，项目歌词继续持久化；删除和替换音源同时释放旧记录。偏好保存在 localStorage，本地修订通知使用 BroadcastChannel。
- `browser/media.ts`：通过 AudioContext 解码本地音频，当前项目持有一份 AudioBuffer／ObjectURL，波形按需缓存三种分辨率，PCM 窗口交给原声谱图 Worker。项目切换、音源替换与工作区卸载时释放资源。
- Demo 保留本地导入编辑、双风格打轴、罗马字与分词、预览及歌词导出。在线获取、声学任务、模型／词典、字形转换、工程归档、音频标签与嵌入功能显示桌面版下载引导；罗马字直接使用已有注音或假名，自动助词识别由桌面版提供。浏览器的音频格式解码能力决定可载入的编码。
