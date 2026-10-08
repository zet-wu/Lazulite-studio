# Server 架构

FastAPI 同源 API，SQLite 管理项目、项目资源索引、修订指针、任务和复核。文件存储管理源媒体、代理/peaks、不可变项目 JSON 与发布成品。

`app.py` 组合认证与路由；`documents.py/revisions.py/project_document.py` 管项目快照与 CAS 保存；`jobs.py/job_routes.py` 管任务/SSE；`reading.py/review.py` 管读音词典和复核；`studio/media.py` 与 `media.py` 管音频窗口；`publish*.py/publishing.py` 管发布和回读。`projection.py` 为引擎构造正文投影，不把 Ruby 或 sidecar 当作正文。

服务是登录者共享项目库的单工作台；模型按配置开放。启动配置与验证命令见[服务端开发说明](../../lyric-workflow/docs/studio/development/server-development.md)，接口摘要见[契约说明](../../lyric-workflow/docs/studio/reference/service-contract.md)。

`lyric_sources.py` 负责四来源检索和载荷解密，歌词语义解析仍在前端。`packaging.py` 写入并回读 MP4/M4A、MP3、FLAC 歌词；`publish.py` 从不可变修订执行任务，`publishing.py` 按显式 track ID 写 STPP。Mutagen 管兼容标签，FFprobe 校验音频 packet hash，源文件保留。vendored QRC 解密器来源及许可见 [vendor](vendor/README.md)。

`project_deletion.py` 负责活动任务阻断、项目目录隔离与关联索引清理，失败回移，重启按数据库状态恢复或清理；源音乐及缓存同样随项目释放。`search_conditions.py` 负责创建时音频标签/上传文件名初始化与三个最终字符串持久化，旧项目不回填。`media_format.py` 按实际内容识别能力及产物后缀；取消在最终结果写锁检查并清理产物，报告记录实际 STPP ID。发布副本将双端点未定的纯空白音译转换为原位置文本，原修订保持不变。


`media_format.describe_media` 排除 attached_pic 封面视频流，结合实际容器保留合法原后缀。`publish` 用打包时项目名生成可下载名称，UUID 内部文件名保持独立；结果记录名称，`publish_routes` 用同一名称生成下载响应，旧结果缺名称时沿用磁盘名。命名不触发转码，不放宽成功回读下载门控。


`time_units.py` 是秒数/高精度 TTML 到整数毫秒的服务边界；修订写入规范化时间，STPP 使用相同毫秒时钟及无前缀正文元素。当前资源数据库列和接口使用 `_ms`。数据库版本 4 拒绝旧结构，默认使用 data-projects-v4，原 data 保留，不包含迁移器。`jobs.reconcile_exports` 保留各项目最近成功且报告通过的记录作为当前产物，退休标记与成功结果同事务提交；物理文件延迟删除可重试，任务记录不删除。`publish_routes` 先打开下载句柄再释放切换锁，以支持下载期间替换。

`vocal_process.py` 为每个人声任务启动并监管独立 Python 子进程，`vocal_worker.py` 调用同一 `vocals.py` 实现，模型初始化／推理与分析不占用 API 的解释器。父进程保留单任务队列、任务状态和阶段事件，子进程直接保存同一数据库的持久结果；通过管道确认阶段边界取消，异常退出只使本次任务失败，服务关闭时终止并回收子进程。仅 API 启动清理未注册目录，工作子进程不执行启动清理。注入轻量 separator 的单元测试在进程内运行。

`vocals.py` 管真实分离、PCM_24 FLAC/安全增益、能量与核心片段持久结果；`vocal_routes.py` 提供结果、能量窗口与下载。任务不绑定歌词修订，取消仅在真实阶段边界生效，分析失败或 ready 重分析均引用已有音频，以新任务 ID 建立独立分析目录，不复制 FLAC。普通分离请求命中有效 ready 结果时直接返回已有 analysis_id，任务 ID 与分析 ID 不要求相同。采用引用必须属于相同项目和资产；已注册结果保留至项目删除，未注册临时目录可清理。播放/图形接口以 vocal ID 选源，代理/peaks 冷构建去重。


人声窗口读取复用持久结果中的时长、采样率、声道和已知 FLAC 格式，不逐请求执行 ffprobe。能量继续从 mmap 数组读取窗口，使用 NumPy 分组最大值聚合，保持原窗口采样语义。开发启动器分别探测 API 和 Vite，记录失败原因、耗时和恢复；启动期限 20 秒，运行期同一端点持续失败 30 秒才关闭进程树，子进程退出仍触发清理。


当前 Lazulite 接入使用 `VocalConfig.frame_length/hop_length`。`analyze_vocals` 返回核心片段及诊断，另由公开的 `build_activity_profile` 获取 `main_rms` 保存为能量：它采用主人声提取和居中取帧，但不做额外时间平滑；不能与默认约 100ms 平滑的 `activity` 或进一步约 400ms 平滑的 `split_activity` 混称。新结果版本 `lazulite-vocal-core-v2-main-rms` 记录当前配置、源码哈希和 SciPy 版本；重分析不原地覆盖旧产物。

人声复用按源资产内容哈希、固定模型配置、Lazulite 分离/解码源码、Demucs/Torch/SoundFile 版本及 PCM 保存版本签名匹配；实际加载权重哈希继续记录在 model 元数据。仅分析源码变化不失效音频。文件完整性按大小/时间戳缓存 SHA256 检查，缺失或损坏允许重新生成；明确重分析指定的历史人声不强制升级模型。默认固定模型按已安装 Demucs 模型目录版本识别，不承诺检测版本不变的私自权重替换。

音频所有者在自己的结果目录保存一份 FLAC，每条分析记录都必须提供 audio_result_id：首次分离引用自身，重分析直接引用原音频所有者。separation_signature 与 audio_sha256 同样必填，不为缺失字段提供旧数据回退。播放、下载及波形缓存统一解析所有者，能量仍按 analysis_id 读取。结果列表附 audio_id 与 audio_state，界面仅暴露当前源的一个人声。启动只清理未注册临时目录，不迁移、合并或改写注册结果；保留所有注册分析和不同内容的音频，避免破坏已保存修订、未保存撤销历史及任务接入。项目删除统一释放它们，不执行无法获知浏览器历史的运行期分析回收。

`POST /api/v1/reading/analyze` 接受 `lines: [{id,text}]` 当前文本快照，沿用会话及写请求来源校验，不创建项目、修订或任务。返回原始 code point 范围、正文及平假名读音；未覆盖范围显式为空，服务不可用返回 503。Sudachi 共用 tokenizer 通过互斥锁序列化分词调用，后续映射不持锁。旧读音任务保留独立接口，但新生成路径不依赖其修订或项目词典。

`furigana.py` 加载随服务部署的固定 JmdictFurigana 资源，校验原始 SHA-256 并缓存精确词形＋读音的唯一有效分段。`reading.py` 以 C 读音为准，先查精确分段，再取可完整回拼的 split(A) 并查子词；tokenize、token 读取与细分共用锁。资源缺损明确使读音服务不可用，不在生成时下载。数据来源、署名、许可及维护方式见 [分段资源](vendor/jmdict-furigana/README.md)。

`documents.validate_ttml` 保留词级 `amll:obscene` 扩展与标准 `ttm:role="expletive"`；任一标记可读，角色按列表识别，expletive 与明确 false 冲突拒绝，普通词／Ruby container／背景词允许明确 true／false；行、背景容器、Ruby 读音及非法值拒绝。规范化时间与不可变修订仍使用相同链路和项目／HTTP 版本。

项目目录 projects/<id> 包含 source/original、cache、revisions、vocals 和 exports；assets 表仅为已关联项目的资源索引，哈希不唯一，不承担跨项目共享。临时上传在 uploads/<token> 校验和建代理后，由创建或首次接入事务转移归属；失败回收，竞争首次接入只允许一份音乐。SQLite 写锁排序上传提交、删除和缓存构建，下载锁内打开句柄、锁外分段读取并支持 Range。重启清理临时上传、无源引用目录及孤立项目目录；已完成放弃上传在后续上传时按一小时回收。

项目快照 v3 与 HTTP 文档 v5 不含源资源 ID，上传不写歌词修订。RevisionStore 保存后和启动保护当前、任务及复核引用，再保留其余最新 100 份和 7 天内修订；回收先移除索引，文件失败由启动清理重试。人声注册历史仍仅随项目删除回收，保留同项目 audio_result_id 复用。

`GET /projects/{pid}/embedded-lyrics` 从项目原始上传文件读取候选，MP3 的 USLT、FLAC 的 LYRICS/UNSYNCEDLYRICS、MP4 的 ©lyr 与各 STPP 轨道分别返回。无音乐、损坏和不支持结构明确报告，不改变项目。STPP 当前仅读取单 sample、单 chunk、无编辑列表或 composition offset 的轨道，支持 stco/co64 与固定或逐项 sample size；多 sample 与分片拒绝。
