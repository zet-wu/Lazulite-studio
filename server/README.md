# Server 架构

服务端基于 FastAPI 提供同源 `/api/v1` 接口，以 SQLite 管理项目元数据、修订指针、会话、幂等与任务状态，文件系统保存源音频、修订快照、人声结果与词典数据。`server.app:create_app` 为 Uvicorn 入口，安装和部署方式见 [开发与构建指南](../docs/development.md) 与 [生产部署指南](../docs/deployment.md)。

## 模块划分

| 模块 | 职责 |
| --- | --- |
| `app.py`、`auth.py`、`upload_audio.py` | 路由装配、密码/网关认证、CSRF 校验与音频/视频上传规范化 |
| `db.py`、`storage_paths.py`、`atomic_file.py` | SQLite（WAL）连接管理、项目级读写锁、相对路径校验与原子文件写入 |
| `documents.py`、`project_document.py`、`revisions.py` | 写入边界 TTML/快照校验、不可变 JSON 修订读取与 CAS 保存/回收 |
| `project_resources.py`、`project_deletion.py`、`music_replacement.py`、`project_storage.py` | Range 流式资源返回、项目删除隔离、音源原子替换与空间统计 |
| `project_archive.py` | `.lazp` 工程归档导出与导入校验 |
| `studio/media.py`、`studio/media_lifetime.py` | FFmpeg 解码、内存 PCM 代理、NumPy 波形峰值与页面租约回收 |
| `jobs.py`、`job_routes.py`、`worker_process.py`、`process_supervisor.py`、`runtime_devices.py` | 单槽任务队列、子进程监督、内存事件取消与设备探测缓存 |
| `vocals.py`、`vocal_audio.py`、`vocal_models.py`、`vocal_offset.py`、`vocal_worker.py`、`vocal_routes.py` | 人声分离与上传处理、偏移估算、声学分析与人声模型管理 |
| `alignment.py`、`alignment_models.py`、`alignment_projection.py`、`alignment_postprocessing.py`、`alignment_worker.py` | CTC 对齐输入投影、模型目录管理、受监管子进程推理与尾点延长 |
| `reading.py`、`furigana.py`、`dictionaries.py`、`dictionary_format.py`、`dictionary_engine.py`、`dictionary_cache.py`、`dictionary_routes.py` | Sudachi/JmdictFurigana 日文注音与助词分析、固定词典安装、扁平词形索引与读音候选；已安装条目采用类型化 JSON 解码，临时缓存后台写入并随进程回收 |
| `shape_conversion.py`、`shape_routes.py`、`generate_shapes.py` | OpenCC 多目标字形转换分析与词典资源生成 |
| `lyric_sources.py`、`embedded_lyrics.py`、`search_conditions.py` | 在线歌词源抓取、内嵌歌词读取与源音频标签搜索条件 |
| `publish.py`、`publish_routes.py`、`packaging.py`、`publishing.py`、`media_format.py` | 无持久化音乐文件打包（MP4 STPP / LRC、MP3 USLT、FLAC LYRICS）与回读校验 |
| `portable.py`、`local_web.py`、`local_server.py`、`instance_lock.py`、`runtime_settings.py` | 本机便携运行入口、防重开锁、本地静态托管与资料库偏好 |

## 持久化与并发

- 数据目录默认为 `server/data-projects-v6`（可通过 `STUDIO_DATA_DIR` 覆盖），每个项目目录包含 `source/original`、`revisions/` 与 `vocals/`。
- SQLite 数据库（版本 6）开启 WAL 模式，配合 `db.py` 提供的按项目粒度读写锁：媒体读取、修订读取与打包下载持有共享读锁，项目删除、音源替换与修订写入/回收持有独占写锁，耗时解码和文件操作均在短 DB 事务之外执行。
- 写入 `PUT /document` 时在外部边界校验并规范化 TTML 与项目快照 v9，原子写入不可变 `revisions/{rev}.json` 并通过 `If-Match` CAS 更新当前指针；内部读取已落盘修订直接走快速反序列化。修订回收保留当前版本与活动任务引用的输入。
- 项目删除先校验无活动任务并将目录移入 `.deleting/` 隔离，再清理数据库记录，异常时回移恢复；音源替换同样通过 `.replacing/` 日志保障崩溃回滚。

## 媒体、人声与自动对齐

- **原曲内存代理**：原曲按需解码为 48 kHz 双声道 int16 PCM 与多级波形峰值，全部驻留内存供 `/audio`、`/waveform`、`/pcm`、`/audio-excerpt` 复用。听审端点校验当前源绑定与最多 30 秒的范围，将有界 PCM 切片重采样为 16 kHz 单声道 WAV，并通过响应头返回实际范围。页面通过 `media-users/{page_id}` 续租，最后一个页面和在途请求释放后自动回收内存。
- **视频上传处理**：`upload_audio.py` 对视频上传提取第一条音轨，优先无损重封装，若容器时间轴不一致则回退为 24-bit FLAC，并校验解码后的播放时间轴一致。
- **局部与全局对齐**：`alignment_projection.py` 按保存修订与可选 `scope_ids` 投影，局部范围覆盖跳过行并使用所选端点包络。人声／原曲与片段裁切独立配置，原曲已有手工片段或关闭裁切时跳过分离；原生片段准备保留源音频时间坐标。预览令牌绑定修订、模型、文本处理选项与局部范围。API 入口通过 `project_alignment` 校验选择范围，工作进程以 `build_alignment_projection` 消费已校验任务。
- **人声与对齐**：人声统一编码为 M4A（AAC-LC）并记录有效采样帧数；`vocals.py` 复用单次 `build_activity_profile` 计算人声能量与片段。对齐与人声分离都在独立子进程中执行，设备探测结果在锁外按首选设备去重并缓存，取消状态通过内存 `Event` 即时通知。

## 注音、词典与字形

- **日文注音与助词**：`reading.py` 复用 Sudachi 与按需懒加载的 JmdictFurigana 索引，提供整行读音分段与 `は`/`へ` 助词识别，`japanese_numbers.py` 生成半角／全角数字基数读音及可选量词音变；第三方词典来源与许可见 [vendor/README.md](vendor/README.md)。
- **固定词典**：词典安装时在临时目录完成公开格式 v1 校验与扁平词形索引构建，原子发布后生效，最多保留两份活动内存索引，并在 `dictionaries/.indexes/` 维护受文件锁保护的运行期磁盘缓存（服务退出自动清理）。分析接口支持 NDJSON 流式进度（`stream=true`）。
- **字形转换**：`shape_conversion.py` 调用原生 OpenCC 输出歧义候选，返回逐字素转换结果与 UTF-16 范围。

## 媒体打包与本机便携模式

- **媒体打包**：`POST /projects/{pid}/packaging/download` 按指定已保存修订实时将歌词写入临时副本并返回流式下载，响应结束后自动清理临时目录。MP4/M4A 支持新增或覆盖 STPP 轨道并可选写入兼容 LRC，MP3 写入 USLT，FLAC 写入 LYRICS；`packaging.py` 在写入完成后执行单遍音频数据包、原媒体箱体与标签/歌词回读校验。
- **本机便携运行**：`python -m server.portable --root <目录>` 仅监听 `127.0.0.1`（默认端口 15173），免密码同源托管 `frontend/dist` 与 API，使用文件锁防止重复启动，并通过相对路径管理 `data/projects` 与 `data/settings.json`。复制便携目录为新资料库时，可在停服后执行 `--new-library-id` 重新生成库 ID。
