# 开发与构建指南

本文档面向参与 Lazulite Studio 源码开发、配置可选模型环境或自行构建本地便携包的开发者。

## 环境要求

- **Python 3.12+**：`vendor/Lazulite` 子模块要求 Python 3.12 及以上。
- **Node.js 22.22.2**（见 `.node-version`）与 **pnpm 10.30.3**（可用 `corepack pnpm@10.30.3`）。
- **FFmpeg 与 FFprobe**：需在 `PATH` 中可直接调用，用于音频解码、重封装与打包检查。

## 克隆与安装基础依赖

克隆仓库时记得带上 `vendor/Lazulite` 子模块，后续命令均在仓库根目录执行：

```sh
git clone --recurse-submodules https://github.com/zet-wu/Lazulite-studio.git
cd Lazulite-studio
```

macOS / Linux：

```sh
python3 -m venv server/.venv
source server/.venv/bin/activate
python -m pip install -r server/requirements.txt
pnpm --dir frontend install --frozen-lockfile
```

Windows PowerShell（若系统限制执行激活脚本，可直接用 `./server/.venv/Scripts/python.exe` 代替 `python`）：

```powershell
py -3 -m venv server/.venv
& ./server/.venv/Scripts/Activate.ps1
python -m pip install -r server/requirements.txt
pnpm --dir frontend install --frozen-lockfile
```

基础依赖包含后端 API、在线歌词获取、日文注音（Sudachi + 随仓库自带的 JmdictFurigana）以及媒体处理库。注音词典可在启动后通过设置里的「注音词典」导入 ZIP，也可以通过环境变量 `STUDIO_DICTIONARIES_DIR` 指定首次启动时自动安装的默认词典目录。词典文本存放在资料库的 `dictionaries/` 中，停服后可直接编辑，重启后会自动重建索引。

## 本地开发运行

在两个终端分别启动后端和前端：

macOS / Linux：

```sh
# 终端一：后端 API
export STUDIO_PASSWORD='replace-with-your-password'
python -m uvicorn server.app:create_app --factory --host 127.0.0.1 --port 8000 --no-proxy-headers --reload --reload-dir server

# 终端二：前端开发服务器
pnpm --dir frontend dev --host 127.0.0.1 --port 5173
```

Windows PowerShell（终端一）：

```powershell
$env:STUDIO_PASSWORD='replace-with-your-password'
python -m uvicorn server.app:create_app --factory --host 127.0.0.1 --port 8000 --no-proxy-headers --reload --reload-dir server
```

浏览器打开 `http://127.0.0.1:5173`，输入上面设置的密码即可使用。Vite 默认将 `/api` 代理到 `http://127.0.0.1:8000`；如果修改了后端端口，可在前端终端通过 `STUDIO_API_TARGET` 指定目标地址（例如 `http://127.0.0.1:8100`）。

如果只想调试前端界面而不需要启动 Python 后端，可以运行 `pnpm --dir frontend dev:mock`（使用 MSW 模拟 API）。

## 可选人声分离与自动对齐环境

### 人声分离

```sh
python -m pip install -r server/requirements-vocal.txt
```

启动服务前配置本地人声模型总目录与计算设备（`cpu` 或 `cuda`，默认 `cpu`）：

```sh
export STUDIO_VOCAL_MODELS_DIR=/absolute/path/to/vocal-models
export STUDIO_VOCAL_DEVICE=cpu
```

在总目录下按需放置对应子目录，之后在设置「模型与计算」的「人声分离模型管理」中刷新并切换（默认使用 Demucs）：

| 子目录 | 所需文件 |
| --- | --- |
| `demucs/` | `htdemucs.yaml` 及其引用的 `.th` 权重文件 |
| `bs-karaoke/` | `bs_roformer_karaoke_frazer_becruily.ckpt`、`config_karaoke_frazer_becruily.yaml` |

如果只使用 Demucs，也可以直接用 `STUDIO_DEMUCS_REPO` 指定单个模型目录；同时设置了 `STUDIO_VOCAL_MODELS_DIR` 时以总目录下的 `demucs/` 为准。

### 自动对齐

```sh
python -m pip install -r server/requirements-alignment.txt
```

该依赖文件同时包含人声分离所需依赖，并附带了 Linux CUDA 栈的版本参考（`constraints-alignment.txt`）；Windows 和 macOS 请按本机平台安装对应的 PyTorch / TorchAudio 构建。

将本地对齐模型放在一个总目录的直接子目录下，并通过环境变量指定目录和计算设备：

```sh
export STUDIO_ALIGNMENT_MODELS_DIR=/absolute/path/to/models
export STUDIO_ALIGNMENT_DEVICE=cpu
```

- **NextFire 模型目录**：包含 `config.json`、`preprocessor_config.json`、`vocab.json`、`model.safetensors` 等文件。
- **MMS_FA 模型目录**：包含 `alignment-model.json` 与 `model.pt`。

自动对齐若需要新分离人声，会使用设置中当前选中的人声分离模型与 `STUDIO_VOCAL_DEVICE`；项目已有可用人声时直接复用。

## 测试与常用检查命令

安装服务端测试依赖：

```sh
python -m pip install -r server/requirements-dev.txt
```

常用验证命令：

```sh
# 前端类型检查、单元测试、翻译检查与构建
pnpm --dir frontend exec tsc -b --noEmit
pnpm --dir frontend test
pnpm --dir frontend i18n:check
pnpm --dir frontend build

# MCP 服务类型检查、单元测试与构建
pnpm --dir mcp typecheck
pnpm --dir mcp test
pnpm --dir mcp build

# 服务端与打包脚本单元测试
python -m pytest server/tests packaging/tests

# 根据 contracts/openapi.json 重新生成前端 API 类型
pnpm --dir frontend contracts:generate
```

## 翻译与多语言维护

界面文案保存在 `frontend/src/i18n/resources/*.json`，`context.json` 记录各键的用途、参考源文与参数说明，支持语言列表在 `server/ui_languages.json` 中统一登记。

- 校验文案完整度与代码引用：`pnpm --dir frontend i18n:check`
- 导出对照表编辑：`pnpm --dir frontend i18n:export /tmp/translations.csv`
- 导入更新指定语言：`pnpm --dir frontend i18n:import /tmp/translations.csv --language en`

新增语言时，先在 `server/ui_languages.json` 登记语言代码、显示名称、日期区域、书写方向与复数规则，再添加对应的 JSON 资源文件。

## 便携包与模型资源构建

`packaging/build.py` 用于在目标平台（Windows x64 或 macOS arm64）上组装可离线运行的便携主包：

```sh
python packaging/build.py --target windows-x64-cpu --output /path/to/output --model-release-tag <release-tag>
```

CI 中可先运行 `--prepare-frontend` 一次性构建前端产物和许可证清单，再通过 `--frontend-dist` 与 `--frontend-licenses` 传入三个目标平台复用。

独立的模型下载 ZIP 由 `packaging/build_models.py` 按 `packaging/models.json` 生成：

```sh
python packaging/build_models.py --output /path/to/assets --cache /path/to/cache
```
