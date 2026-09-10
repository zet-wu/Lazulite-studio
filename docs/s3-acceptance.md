# S3 验收记录

日期：2026-09-10。状态：S3 范围验收通过。开发范围见 [实施记录](s3-implementation.md)。

## 媒体时间与波形

主 Agent 使用 FFmpeg 5.1.8、48kHz 合成脉冲，分别比较上传源的解码 PCM 与 Studio 双声道 PCM WAV 代理。脉冲起点用各自最大振幅的 40% 阈值定位；源文件字节保持一致。时间以源媒体首个解码样本为零，包含静音和源文件自身的编码前导样本，不做自动裁剪。

| 输入 | 容器音轨 start | 源解码脉冲 | 代理脉冲 | 代理新增偏移 |
| --- | ---: | ---: | ---: | ---: |
| AAC / M4A | 0µs | 333333µs | 333333µs | 0µs |
| AAC / M4A，输入 PTS +2s | 1978000µs | 354667µs | 354667µs | 0µs |
| ALAC / MP4，输入 PTS +2s | 2000000µs | 333333µs | 333333µs | 0µs |

第二个样例保留 1024 个编码前导样本，约 21.333ms；这属于源文件解码结果，不能误报成代理新增偏移。元数据保留 `source_start_us`；播放器使用 `studio_us = currentTime × 1000000 + proxy_offset_us`。当前 PCM 代理的 `proxy_offset_us` 为零，以上结果仅覆盖已测样例，不宣称所有编码精确到采样。

每个样例的 level 0–7 波形桶（含最后不足一桶的样本）已逐个与实际代理 PCM min/max 对比，相等。peaks 是流式构建的多级文件缓存，后续请求按窗口 seek 读取。详细结果见 [媒体检查数据](evidence/s3/media-checks.json)。

FFmpeg 的时间戳处理参考 [官方文档](https://www.ffmpeg.org/ffmpeg.html)；Range 响应参考 [Starlette FileResponse](https://starlette.dev/responses/)。最终结论以本仓库固定依赖与样例实测为准。

## 持久服务与必要测试

在仓库根目录运行 `server/.venv/bin/pytest -q server/tests`：7 项通过。覆盖会话与注销、Origin/CSRF、上传与去重、创建幂等、项目分页、鉴权音频 Range、无 Content-Length 的上传体积限制、重开数据库后的项目与修订，以及 CAS 冲突、数据库写入失败不推进指针、草稿物化失败后的恢复。保留 3 项媒体、2 项 API、2 项修订测试。

在 `frontend` 运行 `npm run contracts:generate`、`npm run typecheck`、`npm test`、`npm run build` 和 `PLAYWRIGHT_BROWSERS_PATH=/tmp/lazulite-studio-browsers npm run test:e2e`：类型生成与检查通过，27 项单元测试、5 项原有 Chromium 回归通过，生产构建成功。浏览器回归使用模拟服务；下面的额外验收连接真实 FastAPI，二者分别记录。

环境：Python 3.13.2、FFmpeg 5.1.8、Node 22.22.2、Chromium 140.0.7339.16。测试仅有第三方弃用与终端颜色配置提示，无失败。

## 真实浏览器与界面

使用独立临时数据目录、密码会话和 600 秒合成 WAV 创建项目，重开持久项目并刷新。验收时音频为原生媒体元素按 Range 获取；代理 115200078 字节，初始采样窗口收到 1248955 字节，未要求先下载整曲即可 seek、播放。此数字是单次测量，浏览器仍可自主继续预缓冲。

- 上传取消后迟到结果不会推进创建；模拟服务已创建但响应丢失，重试复用幂等键和已上传资产，只上传一次。
- 点击波形 seek 到约 149.787 秒，键盘右键推进 1 秒；播放/暂停、0.5 倍速、窗口缩放与前后移动通过。
- 一秒 A/B 区间实测回跳 3 次，最大观察到的终点越过约 10.582ms。这是前台 Chromium 的观察值，不是后台调度或无缝音频循环保证。
- 检查 1440、850、390px 宽度；可见按钮与下拉框没有越出视口。主 Agent 复核桌面和手机截图，底部工具栏、波形和上传弹窗可用，无浏览器脚本异常。

证据：[上传结果](evidence/s3/upload-checks.json)、[播放结果](evidence/s3/playback-checks.json)、[桌面工作区](evidence/s3/playback-desktop.png)、[手机工作区](evidence/s3/playback-mobile.png)、[手机上传](evidence/s3/upload-mobile.png)。验收脚本和合成音频使用临时目录，不扩充日常回归测试数量。

## 已知边界

- 当前服务是单所有者共享项目库；受信网关模式必须显式启用。没有多租户隔离或 GPU 推理接入。
- PCM WAV 代理约 11.5MB/分钟；源文件及缓存保留在服务端。取消上传不能撤回已经完成的服务器处理，未引用资产暂不自动清理。
- 项目歌词为只读初始摘要，真实新项目没有可选歌词行。当前行循环入口已有时间有效性校验，但本次真实项目验收覆盖 A/B 循环；富文档保存、导入与行级制作闭环留待 S4 联调。S2 本地编辑仍独立可用。
- 本轮完成开发服务和构建验收，未部署生产站点；编码时间测试的适用范围见上表。
