# Lazulite Studio 项目架构

Lazulite Studio 由浏览器前端与同源本地/服务端 API 组成，面向 Windows / macOS 桌面浏览器的鼠标与键盘操作。前端基于 React 19、TypeScript 与 Vite；后端基于 FastAPI、SQLite 与本地文件系统，并内置 [Lazulite](https://github.com/wuchenyanmo/Lazulite) 承担人声分离与自动对齐计算。

## 目录与模块职责

| 路径 | 职责 |
| --- | --- |
| `frontend/src/app` | 路由、登录会话、Query Provider、错误边界与常驻顶栏 |
| `frontend/src/features` | 项目工作区、编辑画布、声谱图/时间轴、打轴、卡拉 OK、获取与打包界面 |
| `frontend/src/domain` | 项目与歌词数据结构、纯编辑命令、时间轴投影、注音与卡拉 OK 领域规则 |
| `frontend/src/adapters` | TTML / LRC / ASS / NicoKara / SUG 格式读写、HTTP 通信与 IndexedDB 恢复 |
| `frontend/src/shared` | 主题 token、图标、按钮/表单/弹窗/右键菜单等通用控件 |
| `server` | 项目与修订持久化、项目事件 SSE 流、音频代理、读音/词典/字形接口、模型任务与媒体打包 |
| `mcp` | 基于共享领域层与后端 HTTP API 的协议无关语义工具集与 MCP Server（`stdio` 与回环 Streamable HTTP） |
| `contracts` | OpenAPI 契约（`openapi.json`）及前端生成类型来源 |
| `packaging` | Windows / macOS 便携包、精简 Node 22 运行时与模型下载 ZIP 组装脚本 |

详细模块说明见 [前端架构](../frontend/README.md)、[后端架构](../server/README.md) 与 [接口契约](../contracts/README.md)。依赖方向保持单向：`domain` 只包含纯数据与规则；`adapters` 处理格式、网络与存储；`features` 组合交互；`app` 管理应用生命周期；`shared` 提供通用界面组件。

## 数据模型与版本

`ProjectDocument` 是项目内唯一的可编辑文档状态，集中包含：
- `lyrics`：结构化歌词（主行、背景行、词、注音、有序翻译/音译轨道、歌手与元数据）
- `editing`：空拍、跳过连续打轴、跳过对齐、行尾链接等编辑属性
- `acoustics`：人声分析引用与可手动调整的人声片段
- `amll`：AMLL 兼容模式开关与限制
- `lineOrder`：歌词显示顺序
- `karaoke`：导唱符、分组、NicoKara 歌手标记、SUG 歌手覆盖名称、输出勾选与逐文件偏移

| 数据边界 | 当前版本 |
| --- | --- |
| 项目 JSON 快照 | `studio-project-v9` |
| 运行时歌词模型 | `studio-lyric-v10` |
| HTTP 文档接口 | `studio-document-v9` |
| 浏览器本地恢复 | `recovery-v11`（record 11，含源音频绑定身份） |
| SQLite 数据结构 | 6 |
| `.lazp` 工程归档 | manifest 1 |

歌词时间在项目内统一使用整数毫秒（或 `null` 表示未打轴），文本范围使用 Unicode 码点坐标并校验字素边界。主行、背景行、词、注音、歌手与附属轨道均以稳定 ID 关联；词级歌手可覆盖所属行歌手，歌手可携带 `actorRef` 表示角色与扮演者关系。

## 编辑器、打轴与时间轴

- **编辑事务与撤销**：`project-document.ts` 统一执行歌词、声学片段与卡拉 OK 命令，保留 256 步撤销历史。批量操作（拆行、合词、批处理、导入替换、对齐结果应用等）均以单次原子事务提交。
- **选区与快捷键**：`SelectionContext` 协调画布、大纲、时间轴和右键菜单的有效选区。非输入状态下空格键固定控制播放/暂停，文本输入框与弹窗保留各自原生键盘与 IME 行为。
- **打轴与预览**：`sync-editing.ts` 从当前选区派生打轴游标，支持「连续」与「本行」两种模式、空拍消耗以及独立跳过开关。AMLL 预览按需加载，直接消费当前草稿的播放投影。
- **播放与声谱图**：单个 `HTMLMediaElement` 驱动全局播放时钟，原曲与人声的播放音源和图形音源可分别切换，支持 0.1–2× 变速和 A/B 区段循环。声谱图由常驻 Web Worker 按 4 秒瓦片异步计算，采用预计算 1024 点 FFT/Hann 表生成 512×256 瓦片，以频率插值改善对数轴显示；128 瓦片 LRU 缓存保存着色位图，连续瓦片拼带后统一缩放以跨边界插值，驱逐和卸载释放位图与条带画布。
- **时间轴与暂存区**：标尺、波形、声谱图与各轨道共享同一水平视窗和毫秒坐标系。单端未定对象通过投影计算可抓取显示区，未打轴对象可从暂存区拖入时间轴分配时间，或从时间轴拖回暂存区清空自身时间。滚轮默认缩放、`Shift + 滚轮` 平移（可在设置中互换），Ctrl／⌘ 边界拖动联动同行贴合单元并原子提交（可互换默认操作），播放跟随开启时按视窗锚点平滑推进，帧时钟直接同步条块高亮。

## 注音、字形、人声与自动对齐

- **智能日文注音与罗马字**：服务端通过 Sudachi 与 JmdictFurigana 分析整行读音并按假名锚点细粒度切分；前端支持按需开启跨词自动合并，预览框支持手动修改与撤销。罗马字音译基于行内假名上下文生成，并支持从定时音译反向匹配生成注音。
- **固定词典注音**：通过公开格式 v1 的词典 ZIP 提供普通话、粤语、方言等通用自动注音。词典在安装时建立压缩前缀树索引，动态规划给出默认分段并高亮歧义读音供人工确认。
- **字形转换**：调用原生 OpenCC 分析多目标繁简/异体字转换，保留歧义与手改状态后一次应用。
- **人声分离与上传**：支持通过独立工作子进程运行 Demucs 或 BS Karaoke 分离人声，也支持上传外部人声并做波形相关偏移估算。人声统一存为 M4A（AAC-LC）并记录有效采样帧数，声学分析生成人声能量曲线和人声片段供对齐与编辑复用。
- **自动对齐**：`alignment_projection.py` 从已保存修订投影待对齐行，`alignment_worker.py` 在受监管子进程中运行选定的 CTC 模型（NextFire 或 MMS_FA）。支持拉丁归一化与调号数字剥离，后端可按静音检测智能延长结束时间，前端按任务快照合并短空隙并将结果作为单次事务写入文档。

## 歌词获取、格式交换与媒体打包

- **歌词获取**：整合本地文件/纯文本（含单个 SUG 0.3.0 文件导入）、源音频内嵌歌词以及网易云、QQ、酷狗、AMLL TTML DB 四个在线源。
- **格式导出**：统一提供 TTML、LRC / 扩展 LRC / ESLRC / QRC / YRC / LYS、ASS、NicoKara（`.kra` ZIP）与 SUG 0.3.0（JSON ZIP）导出。`lyric-output.ts` 与 `output-validation.ts` 共享内容投影与问题定位，卡拉 OK 导出共用分组选择、逐文件偏移和各自的歌手标记/名称映射配置。
- **音乐文件打包**：采用无持久化直下流程，按当前保存修订直接生成打包副本返回下载。MP4/M4A 支持新增或覆盖 STPP 歌词轨道并可选写入兼容 LRC，MP3 写入 USLT，FLAC 写入 LYRICS。打包器在输出后执行单遍完整性校验，保护原有音轨数据包和非目标元数据。
- **工程归档（`.lazp`）**：包含 `manifest.json`、`project.json` 与可选源音频的 ZIP 包，用于跨设备备份与迁移；导入时校验结构、路径与音频 SHA-256 后建立独立项目。

## 持久化、并发与便携运行

- **保存、外部同步与本地恢复**：前端通过 `If-Match`（修订号 / ETag）和幂等键提交保存，服务端校验文档后原子写入不可变 JSON 修订、更新 SQLite 当前指针并发出 `revision_changed` / `job_updated` SSE 事件。前端 `useProjectDocument` 识别外部修订变更（干净状态自动同步，`dirty` 状态在右下角浮层预警并提供重载或保留草稿），同时通过 IndexedDB 保存 `recovery-v11` 本地草稿。
- **存储与锁边界**：SQLite 开启 WAL 模式，采用按项目粒度的读写锁隔离媒体读取与项目删除/音源替换——`/audio`、`/waveform`、`/pcm` 等耗时读取可并发执行，不再持有全局数据库写锁。媒体代理（48 kHz 双声道 PCM 与多级波形峰值）仅驻留内存，随页面租约和在途请求自动释放。
- **任务与停服**：人声分离和自动对齐通过单槽任务队列在独立子进程中执行，设备探测结果在锁外运行并缓存，取消状态通过内存事件即时传递，并在数据库记录任务结果的消费/忽略确认状态（`job_acknowledgements`）供前后端闭环恢复。停服前拒绝新任务并清理子进程树。
- **本地便携包与 MCP 服务**：`server/portable.py` 以回环地址（默认 `127.0.0.1:15173`）免密码托管静态前端、API 及随包精简 Node 22 运行时的 `app/mcp/server.mjs`（暴露 `/mcp` 回环 Streamable HTTP 端点，并支持独立 `--transport stdio`），使用文件锁防止重复启动，并通过 `data/settings.json` 与相对路径管理项目资料库。

## 测试分层与自动 CI

| 层级 | 位置 | 覆盖重点 |
| --- | --- | --- |
| 前端单元/组件测试 | `frontend/tests/*.test.ts(x)`、`frontend/src/**/*.test.ts(x)` | 领域命令、格式编解码、保存恢复、组件交互与状态逻辑（Vitest） |
| 模拟服务 E2E | `frontend/tests/e2e/` | 基于 MSW 验证选区、焦点、拖动、快捷键与异步界面（Playwright） |
| 真实后端集成测试 | `frontend/tests/integration/` | 连接临时 FastAPI 服务验证保存重开、导入导出、任务与媒体生命周期 |
| 服务端与打包测试 | `server/tests/`、`packaging/tests/` | API 协议、并发与删除事务、媒体打包回读、词典/读音与便携包组装（pytest） |
| 性能专项 | `frontend/tests/performance/` | 面向生产构建验证长文档与媒体缓存边界 |

`.github/workflows/ci.yml` 在每次 `push` 和 `pull_request` 上自动执行前端类型检查、Vitest 单测、i18n 校验、生产构建以及服务端/打包 pytest。
