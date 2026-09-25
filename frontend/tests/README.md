# 前端验收范围

现有测试覆盖 HTTP/模拟请求、TTML 编解码、行/批量编辑与撤销、Ruby、细粒度时间和结构操作、agent/group、项目保存、候选应用及发布适配器。部分组件测试位于 `src/` 下；浏览器用例位于 `tests/e2e/`。

TTML 样例为合成素材，含整体 Ruby、多 agent、非 BMP/组合字符、混合文本、嵌套时间与未知扩展。测试按当前支持的 profile 验证；不能据此认定任意 TTML 都可编辑。

在 `frontend/` 运行：

```sh
npx pnpm@10.30.3 test
npx pnpm@10.30.3 test:e2e
```

安装、类型检查和构建命令见[前端说明](../README.md)。历史结果见 [S2](../../docs/s2-acceptance.md)、[S6](../../docs/s6-acceptance.md)、[S7](../../docs/s7-acceptance.md)。S7 记录了 55 项 Vitest 和 5 项浏览器回归通过，这是当时的执行结果，不是本轮复跑结果。

下一阶段的交互、双工具 TTML 往返、视觉和性能验收见[编辑器计划](../../docs/lyric-editor-implementation-plan.md)。按实际风险补测试，不固化即将删除的旧编辑设计。
