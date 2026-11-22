# 生产部署指南

本文档说明如何在服务器或局域网主机上以生产模式运行 Lazulite Studio。对外网或局域网开放访问时，请务必正确配置认证方式。

## 1. 构建前端静态文件

在仓库根目录执行：

```sh
pnpm --dir frontend build
```

构建产物输出至 `frontend/dist`。前端所有 API 请求均使用相对路径 `/api/...`，部署时通过同一个 Web 服务器同时托管静态页面和反向代理 API。

## 2. 启动后端服务

激活 `server/.venv` 后在仓库根目录启动 Uvicorn：

```sh
export STUDIO_PASSWORD='replace-with-a-strong-password'
export STUDIO_DATA_DIR='/var/lib/lazulite-studio'   # 可选，默认为 server/data-projects-v6
python -m uvicorn server.app:create_app --factory --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers
```

任务队列、项目读写锁和下载锁均由后端进程内维护，因此**单个数据目录必须使用 `--workers 1`**，由 systemd、Supervisor 等进程管理器负责守护与重启。

## 3. 认证模式

支持两种认证模式，二选一即可：

- **内置密码模式（默认）**：设置 `STUDIO_PASSWORD` 环境变量。用户登录后下发 8 小时有效期的会话 Cookie，所有写操作配合 CSRF Token 校验。
- **前置受信网关模式**：设置 `STUDIO_TRUSTED_GATEWAY=true`。此时应用本身不再要求密码，前提是前置网关（如 Authelia、Cloudflare Access、Basic Auth 等）已经实际拦截未授权请求；普通反向代理本身不提供认证。

## 4. Web 服务器与 HTTPS 配置

以 Nginx / Caddy 为例，反向代理需要满足以下几项要求：

| 项目 | 配置要点 |
| --- | --- |
| 静态页面 | 以 `frontend/dist` 为根目录，未命中的前端路由回退到 `index.html` |
| API 代理 | 将 `/api/` 原样保留前缀转发至 Uvicorn（如 `http://127.0.0.1:8000`） |
| 请求头透传 | 透传 `Cookie`、`X-CSRF-Token`、`Range` 与条件请求头（`If-Match` / `If-Range`） |
| 上传限制 | 根据音频/视频与 `.lazp` 工程包大小适当放宽 `client_max_body_size` 与磁盘配额 |
| 代理超时 | 预留足够超时时间，避免大文件上传后的媒体探测、重封装或音乐打包中断 |

如果 HTTPS 在反向代理处终止：
1. 将 Uvicorn 启动参数中的 `--no-proxy-headers` 改为 `--proxy-headers --forwarded-allow-ips '<代理IP>'`（仅填写可信代理地址，避免外部伪造协议头）。
2. 在反向代理中强制覆盖 `X-Forwarded-Proto` 为实际协议（`https`），后端会据此自动为会话 Cookie 设置 `Secure` 标记。

如需在本机临时验证生产构建效果，可使用 `pnpm --dir frontend preview` 预览静态产物。
