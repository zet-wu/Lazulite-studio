# Adapters：外部系统与格式

当前实现：

- `http/`：项目/媒体、文档保存、任务/SSE、读音/词典、复核和发布接口。生成类型来自 OpenAPI，部分接口另有手写类型；当前契约缺口见[契约说明](../../../contracts/README.md)。
- `ttml/`：`lyric-codec.ts` 将 XML 转为 v9 语义文档并重新生成 TTML；支持词/Ruby、背景和有序文档级音译／翻译轨道，已兼容 AMLL 无命名空间子节点和绝对分/小时时间；高精度端点解析后一次舍入为整数毫秒。旧保留树 codec 已移除，x-bg自身时间按外层容器校验，body时长纳入背景end；草稿x-bg写/读studio:id保持背景身份。未知不支持结构报错。
- `recovery/`：project-v3 IndexedDB 检查点，只保存当前完整项目，不保存撤销栈。项目工作区同时保存 base revision；旧本地检查点保留原库，不自动读取或上传。

媒体服务请求已经接入，播放时钟与交互在 `features/MediaTransport.tsx`；PCM 窗口由频谱 Worker 按需读取。`lyric-formats.ts` 组合来源解析与各格式输出，LRC 使用自有渲染器，ESLRC 使用参考库；QRC／YRC／LYS 直接写逐词字段以保留有时间空白。ASS 由 `ass.ts` 从 LyricDocument 直接生成；AMLL 预览投影在 `domain/preview-adapter.ts`，不回写语义文档。

适配器不决定用户是否接受机器结果。音译使用有序文档轨道；AMLL 的逐词音译仅为预览时的临时投影。本轮执行及验证边界见[当前方案](../../../../lyric-workflow/docs/studio-timeline-review/Review-phase4/plan.md)。

翻译语言、类型（内部 purpose）属于文档轨道，原始内容空白及空轨道保留；多歌手agentRefs按原顺序读取/连接IDREFS，草稿及最终交换沿用相同语义。

`project-codec.ts` 在保存边界将结构化歌词与 lyrics.draftTtml 互转；HTTP document v5 保存项目 JSON。人声列表/能量使用生成类型，媒体窗口按 vocal 结果 ID 选源，不接受客户端路径。

`http/reading.ts` 发送当前所选行 ID 与原始正文到 `/reading/analyze`，不需要项目、修订或音译。响应范围为 Unicode code point，未覆盖区间显式返回空读音。草稿不再读写 `studio:alignments`；含该废弃属性的旧文件按不支持结构拒绝，不提供迁移层。

背景正文解析先识别 x-translation／x-roman，不将附属内容送入正文词解析。背景歌手直接从 span 的 ttm:agent 读取并校验；缺省为空。翻译和音译均导出到头部各自轨道，在父行 text for 下用 x-bg 区分背景，普通／定时内容沿用原始语言、时间和空白。相邻主行／背景内容共用 text，其他内容保留顺序及独立 text，只有背景时不创建主行内容；草稿保留内容 kind 和稳定 ID。导入也支持头部背景翻译与普通／定时内嵌音译。装饰括号只剥离背景正文或附属内容最外层一对。

`lyric-validation.ts` 执行当前九种输出的内存序列化以及发布歌词规则，按对象／问题／严重度合并影响格式；补充标点核对提示，格式损失不进入问题列表。`format-description.ts` 提供以当前 TTML 为基线、所选格式的固定六项对照；重叠主行从已知有效端点计算，不依赖 LRC 成功。`output-validation.ts` 与实际导出共用时间门控；下载／发布不复用界面旧结果。KRC 仅导入。项目保存仍是 draftTtml，恢复快照只接受 lyric-v9，不迁移旧 JSON。

`export-separators.ts` 统一无时间纯水平分隔空白判定及副本附着：行首附下一有效单元，其他连续空白附前一有效单元，不跨缺时间正文或跨行。TTML 正文另遵循 xml:space=preserve，可真实表达制表／换行。TTML 定时翻译与音译的裸分隔文本回读为未知端点单元；背景装饰括号先剥离，草稿稳定 ID 和未知时间保持。仅空白的定时附属内容用无端点 span 保留结构，不伪造时间。

`ass.ts` 的 prepareAss 同时服务门控与输出：正文使用明确行边界，普通附属内容用所属行时间，定时附属内容用自身包络；每份内容分别输出，名称提供语言／类型／顺序，角色样式不代表原生轨道语义。先量化绝对端点，再求相对 karaoke 时长，使用 k；同事件重叠／倒序、缺端点、正文越界及量化后空事件拒绝并定位。真实间隙以包含无可见字形 WORD JOINER 的空计时段表达，避免 libass 合并相邻 k 标签。

ASS 画布宽 1920、高至少 1080，按并行字幕行数增加高度；按事件时间分配连续纵向行位，使用四种角色样式，长文本按保守显示列数折行。正文转义花括号，字面反斜杠后加 WORD JOINER 阻断效果转义，实际换行写 N 标签，原始空白保留。此为独立字幕表现副本，不承诺任意 ASS 回导或字体／播放器间像素一致。外部可执行读取／渲染探针为 `tests/ass_export_probe.py`，实际证据归属 lyric-workflow。

`project-codec` 读写项目 v3 的 editing，并验证其稳定 ID 关联；草稿 TTML 仅保留身份、类型和未定时间。导出／打包传入同一快照的 editing，带空拍空白词仍遵守原有时间门控，正式 TTML 不携带项目配置。

`LyricWord.obscene` 的草稿及正式 TTML 映射为词 span／Ruby container 的 `amll:obscene="true"`，背景词同样处理；false 不写，读取允许明确 true／false，非法值及非词位置不静默忽略。恢复继续检查既有 obscene 字段为 boolean。不写 Ruby 独立标记，不双写标准角色，不改变原文。外部消费者兼容范围见工作区实施记录。

项目 v3 快照只含歌词、editing 和 acoustics，音源只来自项目接口。上传使用 /uploads 临时区及 /projects/{id}/music 首次接入；源资源不受歌词撤销、保存或恢复覆盖。
