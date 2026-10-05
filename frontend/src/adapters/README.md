# Adapters：外部系统与格式

当前实现：

- `http/`：项目/媒体、文档保存、任务/SSE、读音/词典、复核和发布接口。生成类型来自 OpenAPI，部分接口另有手写类型；当前契约缺口见[契约说明](../../../contracts/README.md)。
- `ttml/`：`lyric-codec.ts` 将 XML 转为 v8 语义文档并重新生成 TTML；支持词/Ruby、背景和有序文档级音译／翻译轨道，已兼容 AMLL 无命名空间子节点和绝对分/小时时间；高精度端点解析后一次舍入为整数毫秒。旧保留树 codec 已移除，x-bg自身时间按外层容器校验，body时长纳入背景end；草稿x-bg写/读studio:id保持背景身份。未知不支持结构报错。
- `recovery/`：project-v1 IndexedDB 检查点，只保存当前完整项目，不保存撤销栈。项目工作区同时保存 base revision；本地编辑使用文档身份区分检查点。

媒体服务请求已经接入，播放时钟与交互在 `features/MediaTransport.tsx`；PCM 窗口由频谱 Worker 按需读取。`lyric-formats.ts` 用参考工具同版本格式库解析/生成 LRC、ESLRC、QRC、YRC、LYS 和 ASS；AMLL 预览投影在 `domain/preview-adapter.ts`，不回写语义文档。

适配器不决定用户是否接受机器结果。音译使用有序文档轨道；AMLL 的逐词音译仅为预览时的临时投影。本轮执行及验证边界见[当前方案](../../../../lyric-workflow/docs/studio-edit-review/Review-phase8/plan.md)。

翻译语言、用途属于文档轨道，原始内容空白及空轨道保留；多歌手agentRefs按原顺序读取/连接IDREFS，草稿及最终交换沿用相同语义。

`project-codec.ts` 在保存边界将结构化歌词与 lyrics.draftTtml 互转；HTTP document v3 保存项目 JSON。人声列表/能量使用生成类型，媒体窗口按 vocal 结果 ID 选源，不接受客户端路径。

`http/reading.ts` 发送当前所选行 ID 与原始正文到 `/reading/analyze`，不需要项目、修订或音译。响应范围为 Unicode code point，未覆盖区间显式返回空读音。草稿不再读写 `studio:alignments`；含该废弃属性的旧文件按不支持结构拒绝，不提供迁移层。

背景正文解析先识别 x-translation／x-roman，不将附属内容送入正文词解析。背景歌手直接从 span 的 ttm:agent 读取并校验；缺省为空。翻译和音译均导出到头部各自轨道，在父行 text for 下用 x-bg 区分背景，普通／定时内容沿用原始语言、时间和空白。相邻主行／背景内容共用 text，其他内容保留顺序及独立 text，只有背景时不创建主行内容；草稿保留内容 kind 和稳定 ID。导入也支持头部背景翻译与普通／定时内嵌音译。装饰括号只剥离背景正文或附属内容最外层一对。

`lyric-validation.ts` 执行当前九种输出的内存序列化以及发布歌词规则，按对象／问题／严重度合并影响格式；补充格式实际损失与标点核对提示。`output-validation.ts` 与实际导出共用时间门控；下载／发布不复用界面旧结果。KRC 仅导入。项目保存仍是 draftTtml，恢复快照只接受 lyric-v8，不迁移旧 JSON。
