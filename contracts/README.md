# Contracts：前后端协议来源

[openapi.json](openapi.json) 定义 S1 的只读服务契约与 schema，前端生成类型由此产生：

```sh
cd frontend
npx pnpm@10.30.3 contracts:generate
```

合成样例与 MSW handlers 位于 `frontend/src/mocks`。浏览器请求经过 HTTP 适配器和运行时校验，不以 TypeScript 类型断言代替响应校验。

当前 document 接口只提供带 revision 的只读展示摘要，不能用于序列化或保存完整 TTML。领域格式试验独立于 HTTP DTO。后续富文档接口应在 S2 冻结后版本化，不能以行表摘要代替权威文档。

完整目标仍见 [服务契约草案](../../lyric-workflow/docs/lazulite_studio_service_contract.md)：revision/ETag、幂等写入、微秒/null 时间、code point 坐标、job/SSE 恢复、媒体 Range 和错误语义。S1 不包含上传、保存、SSE、媒体或发布端点的实现。
