# 设计索引

当前完整设计保存在并列工作流仓库：

- [前端架构](../../lyric-workflow/docs/lazulite_studio_frontend_architecture.md)
- [服务契约](../../lyric-workflow/docs/lazulite_studio_service_contract.md)
- [实施与验收](../../lyric-workflow/docs/lazulite_studio_implementation_plan.md)

本轮确定的边界：

1. 富歌词模型与 TTML 保留树构成编辑基础，保真验证先于真实编辑开放。
2. 所有歌词修改走可撤销的领域事务；机器结果必须人工应用。
3. 草稿保存采用 revision/ETag；旧任务结果和后台请求不覆盖 dirty 文档。
4. 媒体、项目、任务和模型在服务端管理，前端按能力发现开放功能。
5. 任意数量 agent 从第一版模型支持，Ruby/细粒度数据从导入开始保留。

具体实现开始后，在这里记录已采用的决策与验证证据；对外分发前迁入冻结设计并更新链接。本次 S1 开发与校验见 [验收记录](s1-acceptance.md)，TTML 前置试验见 [profile 记录](ttml-profile-probe.md)。

当前 S1、S2、S3 已验收。S3 项目与媒体范围见 [实施记录](s3-implementation.md)，真实服务、媒体时间和浏览器检查见 [验收记录](s3-acceptance.md)。S2 的本地 TTML、可逆命令与检查点边界见 [实施记录](s2-implementation.md)，测试与浏览器证据见 [验收记录](s2-acceptance.md)。运行与开发命令见 [frontend](../frontend/README.md)，依赖许可见 [记录](dependency-licenses.md)。
