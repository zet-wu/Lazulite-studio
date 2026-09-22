# S7：最终文件与消费端

开始：2026-09-22。依据并列工作流仓库的[实施计划](../../lyric-workflow/docs/lazulite_studio_implementation_plan.md)、[服务契约](../../lyric-workflow/docs/lazulite_studio_service_contract.md)和[总体方案](../../lyric-workflow/docs/lazulite_music_workflow_plan.md)，承接 S1–S6。

## 范围与验收

- 发布绑定不可变源资产与已保存 TTML revision，生成独立 MP4/M4A，不覆盖源媒体。
- 先以合成音频验证 `subt` handler、`stpp` sample entry 和单 TTML sample 的实际封装路径，再接入持久任务。
- 成品开放下载前检查原音轨、元数据与 TTML 回读；失败、任务中断、文件缺失均不得显示为可下载成品。
- 发布页提供歌词导出、发布记录、旧版本提示和回读报告；刷新后从服务恢复状态。
- 检查 MusicBox 消费路径，分别记录容器读取、歌词映射和真实播放器验证结果，不用封装成功代替消费端验收。

## 实施方式

gpt-5.6-luna 子代理编写媒体、服务和前端实现，主 Agent 负责接口指导、审查、浏览器验收和分批 Git 提交。媒体封装、发布服务和页面独立分责，复用已有任务与鉴权基础。

界面参考 AMLL TTML Tool 的文件操作和紧凑分区面板，沿用 Studio 配色与工具栏。桌面左侧显示当前版本及操作，右侧显示发布历史与展开报告；窄屏纵向排列。未保存、保存中或冲突状态下先留在编辑器完成保存。

保留必要的封装回读及 HTTP 门控测试，运行现有前后端回归、类型检查与生产构建，并检查真实服务下的桌面、窄屏发布下载流程。实际支持范围、工具版本及消费端限制在验收记录中填写。
