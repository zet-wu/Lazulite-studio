# Server：服务边界预留

计划使用 Python/FastAPI 提供同源 API，当前未创建服务代码或依赖配置。

职责包括 Project/Asset、SQLite 工作流数据、不可变 TTML 修订、访问控制、流式上传、Range/播放代理/peaks、持久 job 和 SSE、LazuliteService、后续发布及回读校验。

LazuliteService 直接调用独立 Python 库，模型配置由服务端管理；GPU 执行与 HTTP 请求生命周期分开。首版同机、受控执行并发，未来远程 worker 保持浏览器协议不变。

TTML 修订先写文件，再 CAS 提交数据库指针，重启修复物化草稿。机器证据和人工歌词分开保存；引擎没有提供的取消/重放/项目持久化由服务层承担。

详见[服务契约](../../lyric-workflow/docs/lazulite_studio_service_contract.md)。本轮仅为前端划定服务职责，不实施后端。
