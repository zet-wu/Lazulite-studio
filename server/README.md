# Server 架构

FastAPI 同源 API，SQLite 管理项目、资产索引、修订指针、任务和复核。文件存储管理源媒体、代理/peaks、不可变 TTML 与发布成品。

`app.py` 组合认证与路由；`documents.py/revisions.py` 管 TTML 与 CAS 保存；`jobs.py/job_routes.py` 管任务/SSE；`reading.py/review.py` 管读音词典和复核；`studio/media.py` 与 `media.py` 管音频窗口；`publish*.py/publishing.py` 管发布和回读。`projection.py` 为引擎构造正文投影，不把 Ruby 或 sidecar 当作正文。

服务是登录者共享项目库的单工作台；模型按配置开放。启动配置与验证命令见[服务端开发说明](../../lyric-workflow/docs/studio/development/server-development.md)，接口摘要见[契约说明](../../lyric-workflow/docs/studio/reference/service-contract.md)。

`lyric_sources.py` 负责四来源检索和载荷解密，歌词语义解析仍在前端。`packaging.py` 写入并回读 MP4/M4A、MP3、FLAC 歌词；`publish.py` 从不可变修订执行任务，`publishing.py` 按显式 track ID 写 STPP。Mutagen 管兼容标签，FFprobe 校验音频 packet hash，源文件保留。vendored QRC 解密器来源及许可见 [vendor](vendor/README.md)。

`project_deletion.py` 负责活动任务阻断、项目记录与修订/产物清理，失败恢复暂存文件，共享资产保留。`search_conditions.py` 负责创建时音频标签/上传文件名初始化与三个最终字符串持久化，旧项目不回填。`media_format.py` 按实际内容识别能力及产物后缀；取消在最终结果写锁检查并清理产物，报告记录实际 STPP ID。发布副本将双端点未定的纯空白音译转换为原位置文本，原修订保持不变。


`media_format.describe_media` 排除 attached_pic 封面视频流，结合实际容器保留合法原后缀。`publish` 用打包时项目名生成可下载名称，UUID 内部文件名保持独立；结果记录名称，`publish_routes` 用同一名称生成下载响应，旧结果缺名称时沿用磁盘名。命名不触发转码，不放宽成功回读下载门控。


`time_units.py` 是秒数/高精度 TTML 到整数毫秒的服务边界；修订写入规范化时间，STPP 使用相同毫秒时钟及无前缀正文元素。当前资产数据库列和接口使用 `_ms`，旧开发库需要明确重建，不包含迁移器。`jobs.reconcile_exports` 保留各项目最近成功且报告通过的记录作为当前产物，退休标记与成功结果同事务提交；物理文件延迟删除可重试，任务记录不删除。`publish_routes` 先打开下载句柄再释放切换锁，以支持下载期间替换。
