# Contracts：前后端协议来源

[openapi.json](openapi.json) 定义 S1 只读摘要与 S3 会话、项目、上传、媒体和修订下载契约，前端生成类型由此产生：

```sh
cd frontend
npx pnpm@10.30.3 contracts:generate
```

合成样例与 MSW handlers 位于 `frontend/src/mocks`。浏览器请求经过 HTTP 适配器和运行时校验，不以 TypeScript 类型断言代替响应校验。

当前 document 接口只提供带 revision 的只读展示摘要，不能用于序列化或保存完整 TTML。领域格式试验独立于 HTTP DTO。后续富文档接口应在 S2 冻结后版本化，不能以行表摘要代替权威文档。

S3 的文档保存 CAS 是内部存储接口，尚未开放富文档 PUT。自动保存、候选导入、任务/SSE 与发布继续按 [服务契约草案](../../lyric-workflow/docs/lazulite_studio_service_contract.md) 后续实现。创建项目带幂等键；媒体使用项目授权的 Range；波形返回带算法版本和资产 hash 的窗口 min/max。
