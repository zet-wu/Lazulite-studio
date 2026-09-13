# S6：细粒度时间与高级编辑

开始：2026-09-13。依据 [实施计划](../../lyric-workflow/docs/lazulite_studio_implementation_plan.md)、[前端架构](../../lyric-workflow/docs/lazulite_studio_frontend_architecture.md) 与 [服务契约](../../lyric-workflow/docs/lazulite_studio_service_contract.md)，承接 S1–S5 已验收的富 TTML 编辑、持久任务与整体 Ruby。

## 本阶段范围

- word / mora / phoneme 时间单元明确区分正文与 reading 的 Unicode code point 坐标；reading 单元保留 Ruby 与正文映射，采用绝对整数微秒和可空时间。
- 细粒度单元新增、修改、拆合、拖动以及行拆合、整行平移均进入可撤销事务；正文或读音变化不能留下可误用的旧时间。
- 扩大经过往返验证的 TTML profile，未理解结构继续保留并局部只读。歌词事实必须随 TTML 保存，不能只留在项目数据库。
- 歌手组成员管理，检查悬空引用与循环；保留任意数量歌手及合法重叠。
- forced alignment 使用独立引擎接口与明确配置的能力，输入来自已保存且确认的歌词/读音；结果绑定 revision/asset，保留来源与映射，必须人工应用。禁止使用 ASR token 时间替代。

## 界面与实施方式

参考 AMLL TTML Tool 的紧凑侧栏、分区标题、蓝色选择反馈和词级拆合操作。保留桌面三栏，在右侧增加细粒度时间面板；拖动与数值编辑提供等效操作，循环试听复用现有播放器。窄屏沿用单面板切换。主 Agent 负责前端设计和验收，gpt-5.6-luna 子代理负责代码实现，每批验收后提交 Git。

## 验收要求

必要领域/codec 测试覆盖坐标映射、撤销、时间和扩展往返、group 引用；服务测试覆盖 confirmed 输入、能力、持久任务及旧结果绑定。运行类型检查、现有回归与生产构建，并实际检查桌面/窄屏的编辑、拖动、保存重开和导出流程。

至少两后端 PoC 与真实日语歌唱质量基准按总体方案另行完成；合成后端只证明协议闭环，不代表模型质量。实际完成范围、性能测量和未完成项在阶段验收记录中如实列明。
