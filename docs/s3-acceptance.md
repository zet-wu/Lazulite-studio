# S3 验收记录

日期：2026-09-09。状态：验收进行中。开发范围见 [实施记录](s3-implementation.md)。未完成的检查不能由局部测试结果代替。

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

## 待完成

- 真实 API、修订一致性和重启验证。
- Chromium 上传、播放、seek、循环与刷新重开。
- 桌面和窄屏视觉检查。
- 前端类型检查、回归测试与生产构建；后端必要测试。
