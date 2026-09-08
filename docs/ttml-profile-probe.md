# TTML profile probe (S2 前置技术验证)

这是一项前置技术验证，不宣称 S2 完成，也不开放歌词编辑器直接写回 TTML。实现位于 `frontend/src/adapters/ttml`，领域类型位于 `frontend/src/domain/ttml.ts`。

当前验证范围：

- 输入限制为 2 MiB、XML 深度 128；拒绝 DTD/entity，并验证根元素是 TTML namespace 的 `tt`。使用浏览器 `DOMParser` 解析、`XMLSerializer` 重新序列化验证保留树；领域模型不依赖 DOM。
- 按 namespace URI 和 local name 识别 TTML，而不是依赖 `tt:` 等前缀。保留元素/属性 namespace、前缀、顺序、混合文本空白、未知节点和属性。
- 仅将 TTML namespace 的 `p` 作为行，CDATA 计入正文、`br` 转为换行，跳过 metadata、未知 namespace 和 Ruby reading；Ruby 只理解单一 `container(base,text)`，复杂容器及未知值产生 `unsupported-ruby`。Ruby base 记录正文 code-point 半开区间。TTML2 `ttm:agent` 属性按 IDREFS 原样保留；此处有限 profile 依据 TTML2 的 [`tts:ruby`](https://www.w3.org/TR/ttml2/#style-attribute-ruby) 和 [`ttm:agent`](https://www.w3.org/TR/ttml2/#metadata-attribute-agent) 定义。
- 支持 media clock `hh:mm:ss.fraction`、`s`、`ms`，以及并行容器内嵌套相对 begin/end/dur，内部用整数微秒；未知时间值为 `null` 并产生诊断。
- `frame`、`tick`、`seq` 和未知 namespace 结构只读并给出原因；不会猜测 frameRate、tickRate 或 sequential 结束时间。
- 当前整个 probe 都是只读：`serializeOriginal` 可精确保留未修改原文；局部文本写回尚未提供，避免先破坏未知结构。

golden 包含 Ruby 整词、三个 agent、非 BMP 与组合字符、命名空间、nested timing、未知扩展以及 frame/tick/seq。测试刻意保持在五项关键保真行为，不覆盖模板式 getter。

运行：

```sh
./node_modules/.bin/vitest run tests/ttml.test.ts
./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --strict src/domain/ttml.ts src/adapters/ttml/index.ts
```

本次实际结果：6 个 TTML 测试通过；probe 两个源文件的严格类型检查通过。全量前端类型检查（含测试）已通过；完整 S1 验收结果见 [开发记录](s1-acceptance.md)。

当前局限：该 probe 未实现完整 TTML timing grammar、group 编辑、逐字时间、frame/tick 换算或 XML 的安全局部修改。
