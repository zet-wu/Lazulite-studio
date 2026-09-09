# S3：项目与媒体

日期：2026-09-09。状态：开发中，完成项与实际验证结果另记验收文档。

## 范围

依据工作流仓库的 [实施计划](../../lyric-workflow/docs/lazulite_studio_implementation_plan.md)、[前端架构](../../lyric-workflow/docs/lazulite_studio_frontend_architecture.md) 和 [服务契约](../../lyric-workflow/docs/lazulite_studio_service_contract.md)。延续 S1、S2 已验收的本地编辑能力。

- FastAPI 同源 API，默认 cookie 会话；受信网关模式需要显式配置。
- 流式上传、内容寻址资产、SQLite 项目索引与可重开的项目列表。
- 不可变 TTML 修订、事务性当前指针、CAS/幂等基础和重启后的草稿物化恢复。
- 保留源媒体，生成浏览器播放代理，提供经过样例核验的时间原点映射。
- 经项目鉴权的 Range 音频，以及带资产身份和版本的窗口 peaks。
- 上传进度与取消、播放/暂停、seek、速度、循环和波形视窗控制。

S3 的 revision store 是后续保存服务的基础。本阶段项目歌词仍为只读摘要；富文档保存 HTTP、自动保存、导入候选及行级制作闭环进入 S4。`/editor` 继续独立保存浏览器检查点，不把它显示为服务器保存。

## 实现与界面约束

代码由 gpt-5.6-luna 子代理编写，主 Agent 指导、审查与验收。按存储、媒体处理、HTTP 边界和前端功能组件拆分，不引入通用服务框架或额外全局状态库。测试集中在持久化一致性、媒体时间与 Range、上传到重开的关键流程。

前端参考本机 AMLL TTML Tool 的 AudioControls、AudioSlider 与 AudioRegion：紧凑底部播放工具栏、等宽时钟、蓝色播放头与循环区域、可缩放波形。采用 Studio 已有浅灰面板和 CSS Modules，不复制 AMLL 源码或资源。浏览器以 HTMLMediaElement 为时钟，Canvas 只绘制当前视窗，不完整解码歌曲。

## 验收要求

1. 真实 API 上传、创建项目，刷新与服务重启后资产及当前修订一致。
2. 修订写入失败或 CAS 冲突不推进指针；重启可重建 `draft.ttml`。
3. Range 首尾、后缀、越界和验证器；未经登录无法访问媒体。
4. 合成编码样例的脉冲位置与代理映射一致，peaks 按视窗与层级读取。
5. Chromium 实测播放、seek、循环、上传与重开；检查桌面和窄屏布局。
6. 类型检查、必要单元/集成测试、原有浏览器回归和生产构建通过。

按可验收的功能批次提交 Git；完成后记录实际命令、结果和已知限制。
