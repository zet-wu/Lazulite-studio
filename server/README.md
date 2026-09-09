# Studio server

```sh
cd LazuliteStudio
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
STUDIO_PASSWORD=dev STUDIO_ORIGIN=http://localhost:5173 server/.venv/bin/uvicorn --factory server.app:create_app --reload
```

`STUDIO_ORIGIN` 是必需的同源写入校验配置；本地密码模式还需要
`STUDIO_PASSWORD`。当前服务使用短期会话 cookie，不需要配置 session secret。
`STUDIO_TRUSTED_GATEWAY=true` 可显式启用已经完成认证的网关模式，不能根据网络地址推断。
媒体探测、播放代理和 waveform peaks 需要系统命令 `ffprobe` 与 `ffmpeg`，并且二者必须在 `PATH` 中。

S3 是单工作台服务，登录者共享项目库。Lazulite 自动化与 GPU 任务尚未接入；能力接口将歌词编辑、任务执行标为不可用。

Writes require the `studio_session` cookie and matching `studio_csrf` cookie /
`X-CSRF-Token` header (except trusted gateway mode). `POST /session` accepts
`{"password":"..."}`；trusted gateway 模式不需要密码。
Uploads are bounded to 500 MiB and imported through the media probe/proxy
service. Project creation accepts `Idempotency-Key`.

S3 keeps `GET /projects/{id}/document` as the S1-compatible read-only
`DocumentShell` summary. TTML revisions are immutable files committed through
SQLite compare-and-swap. `GET /projects/{id}/audio` serves the normalized WAV
playback proxy; waveform windows carry the asset hash and `peaks-v1` algorithm version.

数据默认写入 `server/data/`，可用 `STUDIO_DATA_DIR` 指定独立目录。SQLite 保存项目、资产元数据、会话和当前修订指针；源媒体按内容 hash 保留，PCM 代理与多级 peaks 是派生缓存。备份时同时保留数据库和整个数据目录。

音频上传上限为 500 MiB，当前在一次上传请求内完成探测与代理生成，不支持断点续传。浏览器使用 Range 播放 WAV，不完整解码歌曲；WAV 代理占用空间约为每分钟 11.5 MB。取消请求不会删除已经生成的共享资产，未引用资产暂不自动回收。

`GET document` 保留 S1 只读摘要协议；`GET lyrics` 下载当前或指定已提交修订。修订存储支持内部 CAS 与幂等事务，项目初始草稿使用合法空 TTML。保存富文档的 HTTP 接口和自动保存属于 S4。

验证（在仓库根目录运行）：

```sh
server/.venv/bin/pytest -q server/tests
```

前端开发另开终端运行 `cd frontend && npm run dev`，Vite 将 `/api` 转发到端口 8000。浏览器实际访问的 origin 必须与 `STUDIO_ORIGIN` 一致，包括主机名和端口。生产部署沿用同源反向代理；本阶段未执行托管或部署。
