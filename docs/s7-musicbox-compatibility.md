# S7 MusicBox 消费端检查

日期：2026-09-22。此记录区分媒体容器检查与消费端支持，不能作为 MusicBox 播放器完整验收。

## 检查对象

- [zet-wu/MusicBox](https://github.com/zet-wu/MusicBox/tree/c3ba3a27ec18160d6ca16511c1119edb431e3b54)：`c3ba3a27ec18160d6ca16511c1119edb431e3b54`。
- [asxez/MusicBox](https://github.com/asxez/MusicBox/tree/d28652e5dace34e56df4170670c0d30a3df0748e)：`d28652e5dace34e56df4170670c0d30a3df0748e`。
- 两者内嵌歌词读取使用 `music-metadata@11.12.3`。`LyricsController.getEmbedded` 先解析文件元数据，再调用 `src/main/utils/metadata.ts` 中的 `extractEmbeddedLyrics`；该函数从歌词标签取值，没有读取 `stpp` sample 的分支。

## 实测

以 FFmpeg 生成 4 秒 AAC/M4A 合成音频，写入 title/artist；Studio 加入单 TTML sample，内容包括整体 Ruby、reading/body 时间、三歌手、重叠行与非 BMP 字符。将 zet-wu 版本的实际 `metadata.ts` 及其本地依赖打包为临时 Node 模块，使用它的指定版本 `music-metadata` 解析产物并调用实际 `extractEmbeddedLyrics`。

[结果](evidence/s7/musicbox-probe.json)：音频和 title/artist 可读，`trackInfo` 可见 `<stpp>`，但 `extractEmbeddedLyrics` 返回 `null`。本次检查没有启动完整 Electron 播放器，也不代表音频播放、Ruby 动画、word timing 或多歌手渲染通过。

## 后续接入边界

MusicBox 需要在主进程增加 `subt/stpp` 单 sample 提取，将完整 TTML 交给现有歌词解析流程，之后再验证 Ruby、时间坐标及任意数量歌手到显示模型的映射。Studio 不用额外歌词标签复制来掩盖这项缺口，也不改写既有元数据。

因此 S7 的 Studio 发布功能与 MusicBox 完整集成必须分开验收；当前消费端兼容检查发现未支持项，不能标记为完整兼容。
