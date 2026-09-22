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

## 实现决策

- `TimingUnit` 使用独立正文/reading 范围，reading 单元始终映射完整 Ruby base；正文单元可以落在 base 内，但不能跨越 Ruby 边界。不同坐标空间可同时存在，不把 reading 音拍硬分配给汉字。
- 标准 TTML `span begin/end` 表达单元时间，领域模型使用绝对整数微秒，写回转换成行内相对时间；`studio:id/kind/null` 只补充编辑身份、粒度和未定值。统一 inline writer 从正文与 Ruby 范围重建已理解内容，保留未标时的间隙文字；未知内联语义保持只读。
- 行拆合前一次性快照 baseline DOM 位置，后续按内部 ID 查找，避免插入新行后路径偏移或重复歌词匹配错误。保留首行 XML ID，新行生成 XML ID；重映射 Ruby/unit ID、坐标及审核侧车。没有可信边界时间时留下未定值，不猜测时间。
- 细粒度事务只复制被编辑的行和单元，历史保留不可变快照；其他原有事务继续沿用既有实现。拖动只在松开指针时提交，数值输入可替代拖动。
- forced runner 单独调用 Lazulite forced 接口，服务端从指定 revision 投影已确认歌词或 reading，裁剪音频并保留原始秒数、整数微秒、输入范围、正文范围、引擎身份和诊断。客户端提供的文本和音频原点不作为事实源。Qwen 通过明确环境变量配置；未配置不开放能力。
- Qwen 真实返回的 character/subword 不冒充 mora/phoneme；前端展示实际粒度，当前只有 word/mora/phoneme 结果能人工应用。合成后端仅用于协议验收。

对齐候选按请求范围应用：reading 请求仅替换目标 Ruby 的读音单元，正文请求仅替换正文单元，保留其他坐标空间的人工时间。
