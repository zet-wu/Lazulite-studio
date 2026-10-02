# Frontend 架构

React/TypeScript/Vite 浏览器 SPA。`src/app` 负责路由与会话；`src/features` 组合用户操作；`src/domain` 持有语义文档、命令、时间和分词规则；`src/adapters` 负责 TTML/HTTP/文件/恢复；`src/shared` 放通用图标与样式。

本地文件与项目入口共用 EditorWorkspace，数据加载/保存容器不同。服务缓存、编辑副本和播放时钟分开；AMLL 为单向预览。当前音译为文档级有序轨道；时间轴、三栏布局与普通/虚拟列表的实际边界见[项目架构](../docs/architecture.md)。

安装、启动、测试命令维护在[前端开发说明](../../lyric-workflow/docs/studio/development/frontend-development.md)，不在本仓库复制开发过程文档。

获取、音频处理、编辑、打轴、预览、打包模式共用容器。原始来源格式经 source-codec 解析，LRC 下载与媒体内嵌共用 lrc 渲染器；媒体任务绑定 saveForPackaging 返回的不可变修订。

项目级 ProjectDocument 持有结构化歌词及声学引用/片段副本，项目层单一历史，边界 JSON 中 lyrics.draftTtml 承载歌词。VocalPanel/VocalTracks 组合后台任务、明确采用及人工片段；共享媒体时间轴在音频处理页移至主区，底部保留唯一播放器控制。
