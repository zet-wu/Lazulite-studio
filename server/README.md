# Server 架构

FastAPI 提供同源 `/api/v1` API，SQLite 管理项目、资源索引、修订、会话、幂等与任务，文件系统保存源音频、缓存、项目 JSON 和产物。`app:create_app` 是 Uvicorn factory 入口，配置和启动见[项目 README](../README.md)。服务以单 worker 维护进程内队列与锁，登录者共享项目库。

| 模块 | 职责 |
| --- | --- |
| `app.py`、`auth.py`、`upload.py` | 应用组合、会话／来源／CSRF、上传边界 |
| `documents.py`、`project_document.py`、`revisions.py` | 文档边界统一建模与 TTML 树校验、不可变修订、CAS 保存与回收 |
| `project_resources.py`、`project_deletion.py`、`project_storage.py` | 资源访问、删除事务、逻辑空间统计 |
| `project_archive.py` | `.lazp` ZIP 校验、导入与导出 |
| `studio/media.py` | FFmpeg／FFprobe、播放代理、波形与 PCM 窗口 |
| `jobs.py`、`job_routes.py` | 持久任务、幂等启动、当前阶段、取消与产物生命周期 |
| `vocals.py`、`vocal_process.py`、`vocal_worker.py`、`vocal_routes.py` | 独立进程人声分离、分析、音频复用、窗口及下载 |
| `alignment_projection.py`、`alignment.py`、`alignment_worker.py` | 全局歌词投影、资源准备、受监管日语对齐 |
| `reading.py`、`furigana.py` | 无状态日文读音快照与词典结构边界与分段 |
| `dictionaries.py`、`dictionary_format.py` | 资料库词典安装、活动记录、实例租约及公开格式 v1 校验 |
| `dictionary_engine.py`、`dictionary_routes.py` | 懒加载前缀索引、全局最优路径及可取消快照注音 |
| `lyric_sources.py`、`embedded_lyrics.py` | 在线载荷与媒体内嵌歌词读取 |
| `publish.py`、`publish_routes.py`、`packaging.py`、`publishing.py` | 快照绑定、歌词写入、媒体回读与下载 |
| `time_units.py`、`amll_compatibility.py`、`karaoke.py` | 时间、输出投影与项目配置边界 |

## 持久化

默认目录 `server/data-projects-v6` 可由 `STUDIO_DATA_DIR` 配置。每个项目独立持有 `source/original`、`cache`、`revisions`、`vocals` 和 `exports`。临时上传在接收时计算一次资源摘要，完成探测及代理后，在创建或首次接入事务中归属项目。资源摘要用于缓存身份，相同文件可分别属于多个项目。

项目快照 v9 通过文档 envelope v9 传输，歌词为 draft TTML，资源数据库版本为 6。RevisionStore 原子写文件后比较并交换当前 revision；幂等提交响应保存原修订身份，响应与发布均复用本次处理结果；回收只保留当前版本与活动任务实际使用的输入；SQLite 事务保护选取至读完文件的过程，取消请求保持输入至工作进程退出。删除项目先检查任务并隔离目录，失败回移，启动按数据库状态恢复。归档 v1 在写入／解包流中计算摘要，导入验证后复用摘要并创建新项目、校验引用；空间接口按项目实际文件统计五类逻辑字节。

## 模型与媒体

Lazulite 源码位于仓库根目录的固定 Git 子模块 `vendor/Lazulite`，基础安装从仓库根目录读取 requirements。`STUDIO_VOCAL_MODEL` 默认 `htdemucs`，`STUDIO_VOCAL_DEVICE` 默认 `cpu`；自动对齐首次分离使用 `htdemucs`。`STUDIO_NEXTFIRE_PATH` 提供本地 Wav2Vec2 CTC 模型目录，`STUDIO_ALIGNMENT_DEVICE` 默认 `cpu`。模型可用性检查读取配置，计算由任务子进程执行。

人声以 44.1 kHz 双声道 float32 输入 Demucs，按整曲峰值处理后保存一份 PCM_16 WAV；分析重读此文件，能量保存 `main_rms`，核心片段和配置保存于独立分析记录。每条记录以 `audio_result_id` 引用音频所有者，重分析复用 WAV。访问及复用通过 WAV 格式、位深、实际帧数、采样率与声道检查可用性，音频所有者 ID 管理持久资源身份；复用条件由源资产、公开配置及生成规则决定。已注册分析与音频保留至项目删除。

原曲通过 48 kHz 双声道代理播放，人声播放／窗口／下载使用真实 WAV。波形与播放代理冷构建去重，能量通过 mmap 分桶读取；窗口接口复用已知媒体元数据。

读音接口接收当前行文本并返回 code point 范围。Sudachi C、A 细分与 JmdictFurigana 精确分段共用整行读音；词典按结构加载，同结构数据可替换，索引按进程缓存。来源及许可见 [vendor](vendor/README.md)。

固定词典由 `/api/v1/reading/dictionaries` 管理。选择 ZIP 时仅读取目录与必要元数据；确认后在临时目录中一次校验词条并建索引，原子发布成功后更新缓存，失败保留旧实例和缓存。每次安装及服务启动分配新的实例身份；请求绑定实例，更新和移除保留进行中请求所需的旧目录，文件占用导致的清理延后会在管理界面报告。活动记录原子写入，默认包的首次安装和明确移除随资料库保存。索引采用压缩前缀树与紧凑候选数据，只保留一份活动缓存，安装成功后接管本次构建的索引，后续查询可直接复用；基础成本或包内整数成本参与整行动态规划，最佳路径中无法一致确定的最小正文范围返回歧义。API 用 code point 范围，字素边界与固定单元由格式契约约束。

`STUDIO_DICTIONARIES_DIR` 指定默认 ZIP 目录；便携启动指向 `resources/dictionaries`。`packaging/dictionaries.json` 选择公开 Release，打包时下载所列资产并使用相同格式校验。词典来源与许可随 ZIP 保存，完整词典可在离线目标机首次安装。用户编辑后的合法内容按实际文件读取，项目只保存最终 Ruby 单元。

## 输出与接口

TTML 草稿保存保留待修正时间与 Studio 身份，发布阶段检查实际目标格式。MP4/M4A 的 STPP 与歌词标签、MP3 的 USLT、FLAC 的 LYRICS 写入独立副本，回读检查音频 packet hash、原有媒体数据、非目标轨道与标签。成功报告通过后开放下载；替换产物保留任务记录，文件占用时延后重试清理。

服务接收稳定 ID、revision 与业务参数，资源路径与模型配置由服务构造。来源通过 `normalize_origin` 精确规范化匹配，密码模式结合会话 cookie 与 CSRF。接口字段见[契约](../contracts/README.md)，跨模块行为见[项目架构](../docs/architecture.md)。


## 本机便携运行

`python -m server.portable --root <完整包目录>` 只绑定 `127.0.0.1`，默认端口 15173，提供生产前端与 API 同源入口。运行模式为 local，免口令，但所有请求必须匹配 Host，写入必须匹配 Origin。私人部署继续使用上述密码／网关入口；本机模式不继承宿主设备设置。启动器在初始化／清理前取得 OS 文件锁，重复启动通过 nonce、资料库 ID、目录和端口握手。仅在 readiness 成功后打开浏览器。

便携包 `data/projects` 保存 SQLite 与项目树，`data/settings.json` 保存资料库身份及长期偏好；偏好 API 为 `GET/PATCH /api/v1/settings`，PATCH 需要 `If-Match` 并只修改提交字段。数据库为 v6，资源路径只记录相对数据根的 POSIX 路径；启动清理前验证归属、缺失修订及符号链接。项目 v9／歌词 v10／文档 v9／工程包 v1。

服务只打开当前 v6 数据库；不支持的版本在写入前明确拒绝。移动整个便携目录保留 library ID；复制为另一独立库时停服执行 `python -m server.portable --root <副本> --new-library-id`。

分离／对齐设备在任务开始时探测并固定进请求；GPU 不可用可在准备阶段选 CPU，GPU 计算失败不自动重跑。`POST /api/v1/jobs/{id}/retry-cpu` 仅接受可归因设备的失败及原 revision，创建新任务；长期偏好不变。`STUDIO_DEMUCS_REPO` 指向完整本地 htdemucs 仓库，本机包强制离线模型路径。分离复用身份不含安装路径或计算设备。

停服先拒绝新任务、取消排队、请求运行任务停止，再在宽限后回收模型及 FFmpeg 进程树。POSIX 使用独立进程组；Windows 使用 kill-on-close Job Object。轮换日志为 5 MiB × 3 份备份，常规日志省略模型原始输出和 traceback，不自动上传。

卡拉数据模型允许空分组列表；导唱默认值由文字和三个阈值组成，标准组角色由 ID 决定。歌手集合配置含必需 `skip`，与项目 v9 快照一同通过保存及归档往返。源音频标签接口 `GET /api/v1/projects/{pid}/source-metadata` 复用创建项目标签解析，返回当前 `asset_id` 与 `title`／`artist`／`album`，由调用方明确保存搜索条件。标签失败返回对象级错误说明。
