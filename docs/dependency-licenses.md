# 直接依赖许可记录

来源：本次锁定并安装的 package.json 元数据。运行依赖与开发工具分别列出，完整传递依赖见 pnpm-lock.yaml，各软件许可正文随安装包保留。

## 运行依赖

| 包 | 版本 | 许可 |
| --- | --- | --- |
| @tanstack/react-query | 5.85.5 | MIT |
| react | 19.1.1 | MIT |
| react-dom | 19.1.1 | MIT |
| react-router-dom | 7.8.2 | MIT |

## 开发工具

| 包 | 版本 | 许可 |
| --- | --- | --- |
| @testing-library/jest-dom | 6.8.0 | MIT |
| @testing-library/react | 16.3.0 | MIT |
| @playwright/test | 1.55.0 | Apache-2.0 |
| @types/react | 19.1.10 | MIT |
| @types/react-dom | 19.1.7 | MIT |
| @types/node | 22.18.0 | MIT |
| @vitejs/plugin-react | 5.0.2 | MIT |
| jsdom | 26.1.0 | MIT |
| msw | 2.11.1 | MIT |
| openapi-typescript | 7.9.1 | MIT |
| cross-env | 10.0.0 | MIT |
| typescript | 5.9.2 | Apache-2.0 |
| vite | 7.1.3 | MIT |
| vitest | 3.2.4 | MIT |

AMLL TTML Tool 仅作为布局与交互参考，本次未复制其源代码、字体和资源，也未引入 AMLL npm 包。引入预览适配器时再核验具体包版本、许可和表现能力。

## S3 Python 服务与工具

来源：本机安装包元数据，直接版本见 `server/requirements.txt`。

| 包 | 版本 | 许可 |
| --- | --- | --- |
| fastapi | 0.115.6 | MIT |
| uvicorn | 0.34.0 | BSD-3-Clause |
| python-multipart | 0.0.20 | Apache-2.0 |
| pytest（测试） | 8.3.4 | MIT |
| httpx（测试） | 0.28.1 | BSD-3-Clause |
| starlette（传递依赖，本次 Range 验证版本） | 0.41.3 | BSD-3-Clause |
| SudachiPy | 0.6.10 | Apache-2.0 |
| sudachidict_core | 20250129 | Apache-2.0 |

FFmpeg/ffprobe 是系统前置工具，不随仓库分发；本次使用系统 FFmpeg 5.1.8，发行版启用 GPL 构建选项。后续打包时需按实际构建重新核验许可。
