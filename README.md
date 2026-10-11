# Lazulite Studio

面向桌面浏览器的歌词制作工作台，提供歌词获取、音频处理、歌词编辑、打轴、AMLL 预览、卡拉 OK 制作与文件打包。

React 前端管理项目草稿、统一撤销历史和试听；FastAPI 服务管理项目资源、保存修订、模型任务及媒体打包。TTML 承载歌词保存与交换，`.lazp` 工程包保存项目快照及可选源音频。每个项目独立保存资源，音乐可按需接入。

## 功能

- 从本地文件、文本、音频内嵌歌词及网易、QQ、酷狗、AMLL TTML DB 获取歌词。
- 编辑正文、Ruby 注音、背景行、多轨翻译／音译、行级与词级歌手及毫秒时间。
- 使用连续／单行打轴、可缩放时间轴、A/B 循环与保音高变速试听。
- 使用日文自动注音、罗马字生成、Demucs 人声分离、声学片段和日语自动对齐。
- 导出 TTML、LRC 等歌词、ASS 字幕及 NicoKaraMaker 3 `.kra` ZIP；将歌词写入 MP4/M4A、MP3、FLAC 副本。

## 开发与构建

环境：Python 3.12+、Node.js（版本见 `.node-version`）、pnpm 10.30.3，以及 PATH 中的 FFmpeg/FFprobe。以下命令在仓库根目录运行；Windows PowerShell 使用 `server/.venv/Scripts/Activate.ps1` 激活环境。

```sh
python -m venv server/.venv
source server/.venv/bin/activate
python -m pip install -r server/requirements.txt
pnpm --dir frontend install --frozen-lockfile
```

在已激活虚拟环境的终端配置服务并启动：

```sh
export STUDIO_PASSWORD='replace-with-your-password'
export STUDIO_ORIGIN='http://127.0.0.1:5173'
python -m uvicorn server.app:create_app --factory --host 127.0.0.1 --port 8000 --reload --reload-dir server
```

PowerShell 的环境变量写法为 `$env:STUDIO_PASSWORD='replace-with-your-password'`、`$env:STUDIO_ORIGIN='http://127.0.0.1:5173'`。另开终端运行 `pnpm --dir frontend dev`，访问 `http://127.0.0.1:5173`。Vite 将 `/api` 代理至 `http://127.0.0.1:8000`，可用 `STUDIO_API_TARGET` 配置目标；`STUDIO_ORIGIN` 对应浏览器实际访问来源。

生产构建运行 `pnpm --dir frontend build`，静态产物为 `frontend/dist`。由 Web 服务器提供静态文件、SPA 路由回退，并将同源 `/api/` 代理至 Uvicorn。API 使用上述 factory 入口，生产运行采用单 worker，配置实际浏览器来源并省略 reload 参数。SSE 代理需关闭缓冲并允许长连接。服务进程管理项目内任务与文件锁，数据目录由 `STUDIO_DATA_DIR` 指定，默认 `server/data-projects-v4`。

可选人声运行时：`python -m pip install -r server/requirements-vocal.txt`。自动对齐运行时：`python -m pip install -r server/requirements-alignment.txt`；其中设备栈约束面向 Linux CUDA，Windows/macOS 部署应选用匹配平台的 Torch/torchaudio 组合。`STUDIO_NEXTFIRE_PATH` 指定本地模型目录，`STUDIO_ALIGNMENT_DEVICE` 和 `STUDIO_VOCAL_DEVICE` 默认 `cpu`。依赖与模型可用性由设置页展示。

## 验证

```sh
python -m pytest -q server/tests
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir frontend exec playwright install chromium
pnpm --dir frontend test:e2e
```

## 架构入口

- [项目架构](docs/architecture.md)
- [前端](frontend/README.md)、[服务端](server/README.md)、[接口契约](contracts/README.md)
- [开发约定](AGENTS.md)、[随包第三方资源](server/vendor/README.md)
