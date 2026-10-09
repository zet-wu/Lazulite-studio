# Frontend 架构

React/TypeScript/Vite 浏览器 SPA。`src/app` 负责路由与会话；`src/features` 组合用户操作；`src/domain` 持有语义文档、命令、时间和分词规则；`src/adapters` 负责 TTML/HTTP/文件/恢复；`src/shared` 放通用图标与样式。

项目统一使用 Workspace 和 EditorWorkspace，本地文件是歌词获取的输入方式；音乐可选，保存均走项目服务。服务缓存、编辑副本和播放时钟分开；AMLL 为单向预览。当前音译为文档级有序轨道；时间轴、三栏布局与普通/虚拟列表的实际边界见[项目架构](../docs/architecture.md)。

安装、启动、测试命令维护在[前端开发说明](../../lyric-workflow/docs/studio/development/frontend-development.md)，不在本仓库复制开发过程文档。

获取、音频处理、编辑、打轴、预览、打包模式共用容器。原始来源格式经 source-codec 解析，LRC 下载与媒体内嵌共用 lrc 渲染器；媒体任务绑定 saveForPackaging 返回的不可变修订。

项目级 ProjectDocument 持有结构化歌词及声学引用/片段副本，项目层单一历史，边界 JSON 中 lyrics.draftTtml 承载歌词。VocalPanel/VocalTracks 组合后台任务、成功自动原子接入（重处理替换片段）及人工片段；共享媒体时间轴在音频处理页移至主区，底部保留唯一播放器控制。


Phase 2 的波形/能量使用稳定预取窗口和有界查询保留，按真实覆盖区重投影；能量只按可见桶缩放。共享 Select 测量真实弹层高度并约束视口位置。实现边界见项目架构，实际验收在工作区人声 Phase 2 证据中记录。

项目列表通过归档接口导入／导出 `.lazp`，通过独立查询按需加载当前展示项目的实际空间；明细和刷新不进入编辑历史。归档输入使用服务端校验后的唯一项目快照，源服务分析身份不进入新项目。

`shift-lines` 显式歌词命令在项目事务中同步所属三类导唱，两个 UI 入口共享提交逻辑；通用 `reconcileKaraoke` 仍只维护锚点身份。Nicokara Ruby 只在量化后与 base 齐平时去掉 reading 尾标签，正文生成仍保留结束标签。

人声 WAV 的波形／PCM 使用持久文件真实采样率与声道，声谱图按音源元数据生成 FFT 上下文请求，worker 用响应采样率计算频率和帧位置；原曲仍使用 48 kHz 代理。切换音源按资源身份和采样率重建频谱缓存。
