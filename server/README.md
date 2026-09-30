# Server 架构

FastAPI 同源 API，SQLite 管理项目、资产索引、修订指针、任务和复核。文件存储管理源媒体、代理/peaks、不可变 TTML 与发布成品。

`app.py` 组合认证与路由；`documents.py/revisions.py` 管 TTML 与 CAS 保存；`jobs.py/job_routes.py` 管任务/SSE；`reading.py/review.py` 管读音词典和复核；`studio/media.py` 与 `media.py` 管音频窗口；`publish*.py/publishing.py` 管发布和回读。`projection.py` 为引擎构造正文投影，不把 Ruby 或 sidecar 当作正文。

服务是登录者共享项目库的单工作台；模型按配置开放。启动配置与验证命令见[服务端开发说明](../../lyric-workflow/docs/studio/development/server-development.md)，接口摘要见[契约说明](../../lyric-workflow/docs/studio/reference/service-contract.md)。

`lyric_sources.py` 负责四来源检索和载荷解密，歌词语义解析仍在前端。`packaging.py` 写入并回读 MP4/M4A、MP3、FLAC 歌词；`publish.py` 从不可变修订执行任务，`publishing.py` 按显式 track ID 写 STPP。Mutagen 管兼容标签，FFprobe 校验音频 packet hash，源文件保留。vendored QRC 解密器来源及许可见 [vendor](vendor/README.md)。
