# Lazulite Studio 项目架构

2026-09-28 更新，本文随 Phase 3 分包更新实际架构。实施计划与已验证范围分别见外部[方案](../../lyric-workflow/docs/studio/plans/phase3-timeline-layout-remediation.md)、[当前状态](../../lyric-workflow/docs/studio/current-state.md)，不计入当前能力。

## 1. 应用与目录

React 19 / TypeScript / Vite SPA，React Router 负责路由，TanStack Query 管理服务缓存，CSS Modules 管布局，TanStack Virtual 渲染变高列表。AMLL 0.5.2 按需预览；`hyphen` 与 `wanakana` 用于音节/假名处理。具体版本由 `frontend/package.json` 和锁文件固定。

| 位置 | 职责 |
| --- | --- |
| `frontend/src/app` | 路由、会话、Query provider、错误边界 |
| `frontend/src/features/editor` | 共用画布、行/词/Ruby、分词/批处理/音译、打轴、预览、菜单 |
| `frontend/src/features/Workspace.tsx` | 项目连接、保存、候选、词典/复核和媒体组合 |
| `frontend/src/features/MediaTransport.tsx`、`TimelineTracks.tsx` | 主媒体时钟、波形/PCM 声谱图、循环和时间轴 |
| `frontend/src/domain` | 语义文档、命令/历史、文本边界、分词、时间、预览投影 |
| `frontend/src/adapters` | HTTP、TTML、其他歌词格式、IndexedDB |
| `contracts` | OpenAPI 及生成类型来源，存在已知覆盖缺口 |
| `server` | FastAPI、SQLite、资产/修订文件、任务、读音和发布 |
| `tests/fixtures/ttml` | 前后端测试共用合成 TTML 输入；不依赖外部文档仓库 |

## 2. 路由与组合

`/editor` 由 LocalEditor 管本地文件与检查点，`/projects/:projectId/edit` 由 Workspace 管项目；两者使用同一个 EditorWorkspace、领域命令和 codec。项目路由有音频服务与保存冲突处理；本地路由没有同等媒体资产能力。

其他路由为 `/projects`、`/projects/:projectId/export`、`/login`、`/settings`。编辑器当前提供编辑/打轴/预览及一级“项目辅助”占位；大纲、歌词列表、属性各自滚动，元数据与歌手分别在设置弹窗中编辑。两侧独立显隐，默认190px/250px，范围160–360px/200–420px；6px分隔条支持指针捕获、取消、键盘8/32px、双击默认。拖动直接预览grid几何，仅分隔条更新自身ARIA，松手才提交工作区偏好；单一localStorage偏好不进入文档/history，resize仅限制渲染宽度；普通/虚拟列表共用显式ID/serial定位：远端先挂载，再按真实卡片矩形平滑居中，超高卡片靠顶；有界校准，新请求及用户滚动取消，尊重reduced-motion，不抢焦点。EditorMenu与EditorRibbon共用单一activeMenuId；受控details保留输入挂载，跨菜单互斥，命令/外点/Escape关闭（Escape回触发器），离开200ms关闭并保护菜单内键盘焦点；文件cancel监听独立清理。

## 3. 权威文档与事务

`LyricDocument`（`studio-lyric-v5`）为唯一可写歌词文档，含 lines、romanizationTracks、agents、metadata、language。行包含 words、背景父 ID、agentRefs、翻译与时间链接；词含 text、时间、Ruby 单元、对齐单元、空拍等。音译轨道按主行 ID 引用，保存语言、顺序、plain/timed 内容及定时单元。正文由词拼接，读音由 Ruby 拼接。

时间使用绝对整数微秒/null；拆分坐标使用 code point 并检查 grapheme 边界。`lyric-commands.ts` 提供纯函数事务与 256 次历史。背景勾选时原子附属最近的前一主行，前行已占用即拒绝，不向更早或后方寻找；下拉仅建立关系后启用，显示动态Lx，value保留稳定ID。内容/链接/时间约束仍由单一命令校验。selection、focus、播放时钟不作为歌词权威内容；批量操作一次入历史，最终改动经 codec 保存。

词级与行级旧音译字段已移除，预览临时派生逐词音译与二侧歌手状态。音译轨道在主行下作为独立附属内容编辑；“从音译生成 Ruby”只在显式提交时把提案写入 Ruby，源轨道继续保留。旧格式数据直接丢弃，不设迁移或双写。

## 4. 格式与保存

`adapters/ttml/lyric-codec.ts` 解析为语义文档并规范化导出，旧 XML 保留树模型已移除。支持常见词/Ruby/背景、行内和 iTunes sidecar 附属内容、当前草稿辅助属性，以及 AMLL 无命名空间子节点和绝对分钟时间修复；未知不支持内容会报错，不宣称任意 TTML 可无损编辑。

`lyric-formats.ts` 支持文本、LRC/ESLRC/QRC/YRC/LYS 双向与 ASS 导出。低表达力格式不能携带全部 Ruby/元数据或多条音译轨道。预览投影只使用完整时间，不修改文档；isDuet 从歌手引用派生。

项目由 `useProjectDocument` 持有本地副本、dirty、revision/ETag、保存序号和冲突。IndexedDB 保存当前格式检查点；FastAPI 接受 TTML envelope，不接收浏览器对象图。修订以不可变文件与 DB 指针提交。候选只能由用户应用。

## 5. 媒体与服务

HTMLMediaElement 为项目主时钟，媒体代理 offset 在边界转换；服务提供音频 Range、窗口 peaks 和 PCM。PCM代理固定48kHz双声道s16le，Studio时间从解码样本0开始，播放offset为0；PCM请求最多4.02秒，包含FFT上下文。声谱图 Worker 按需计算，BPM 提供手动/Tap/自动估计。时间轴用微秒 viewport 显示波形、标尺与歌词轨道，普通滚轮按指针锚点缩放、空白处拖动平移；A/B 仅有一个数值区间状态，当前行/单元命令写入当时精确边界，不和歌词历史绑定。

波形、标尺、A/B、声谱图与歌词轨道共享36px标签和5px间距后的实际绘图区；边框采用内阴影，不占时间映射宽度。顶部显示视窗，定位A/B位于底部循环组；行、词、Ruby分别用确定性O(n log n)区间分轨，布局从真实区间计算，文档提交后才重排。删除行抽样和最小色块宽度；视窗裁剪不伪造端点，选中对象有分离边界控件和放大入口。绘图区整体限制高度并纵向滚动，控制组保留。背景和所选定时音译另有只读轨道。

声谱图使用4秒核心片、512点Hann FFT和固定384×96显示网格（频率范围/色标不变）；视窗超过20秒提示放大。最多128个强度tile的简单LRU约4.5MiB，PCM转移后释放，不保留持久RGBA/位图；同时最多2个在途请求，取消离开视窗的网络工作；已进入Worker的过期计算直接终止并重建Worker，防止快速平移堆积任务，token拒绝过期结果。项目/资产/算法身份决定实例生命周期，隐藏/收起卸载后停止提交并释放Worker；分片两侧按48kHz样本位置请求半FFT上下文，Worker仅生成核心列，末片按真实时长绘制；Canvas相邻片共用取整设备像素边界。波形/频谱共用ResizeObserver及DPR变化监听，设备像素尺寸随显示变化重建。加载/失败片段与低能量颜色分开，失败有显式重试。

服务为登录用户共享项目库的单工作台，显式配置会话/网关模式。任务状态持久化，SSE 提供变化，结果从资源接口读取。reading、词典与实验 forced 的可用性取决于配置；HTTP 通过不代表模型质量。

发布读取已保存修订，为受支持非分片 MP4/M4A 添加单 sample STPP 并回读校验后下载。MusicBox 消费端的已知限制仍在；本次不改发布实现。

## 6. 文档与依赖边界

领域不依赖 HTTP/DOM；适配器处理格式和服务，功能组件组合交互。模型变化时直接更新当前实现，不建立旧 schema 双写/回退。必要输入校验、撤销和保存一致性仍保留。

本仓库保留本文、模块结构说明与 AGENTS.md。方案、运行手册、过程及验收在 [lyric-workflow/docs/studio](../../lyric-workflow/docs/studio/README.md)，两者冲突时更新实际架构说明，不能把未来方案混成已实现状态。
