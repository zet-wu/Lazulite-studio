# Adapters：格式、服务与恢复

适配器将外部文件、HTTP 与浏览器存储转换为领域数据，用户采用提案由功能组件和项目命令管理。

## TTML 与项目

`ttml/lyric-codec.ts` 读取支持的 TTML／Apple 扩展／AMLL 约定，映射为 LyricDocument；草稿序列化保留稳定身份和待定时间，正式输出保留歌词语义与 XML 身份。翻译与音译写头部轨道，背景附属内容按背景 ID 引用；正文、背景、词、Ruby 和定时单元保留自身时间。

词级 `obscene` 写 `amll:obscene` 与标准 `ttm:role="expletive"`，读取任一标记并检查冲突。歌手定义支持 `actorRef`，codec 校验引用；歌词编辑界面提供歌手身份、名称、类型及顺序管理。

`project-codec.ts` 读写项目 v7：lyrics 在 JSON 边界保存为 draftTtml，editing、acoustics、amll、lineOrder、karaoke 独立保存并验证引用。`recovery` 用 IndexedDB 保存 project-v7／record 7 检查点及基础修订。源音频身份由项目资源接口提供。

## 格式投影

`lyric-formats.ts` 分派文本、LRC／扩展 LRC／ESLRC／QRC／YRC／LYS 导入导出、KRC 导入及 ASS 导出。`source-codec.ts` 处理来源载荷，`lrc.ts` 统一歌词下载与媒体内嵌 LRC。`export-separators.ts` 保留空白原文并按格式能力附着到相邻有效单元。

`ass.ts` 从正文、背景和附属内容生成事件，先量化绝对端点至厘秒，再计算相对 karaoke 时长；普通附属取所属行时间，定时附属取自身包络。事件使用四类角色样式与按时间分配的纵向行位，画布宽 1920、高至少 1080，真实间隙用空计时段表示。

`nicokara.ts` 按组与轨道生成 `.kra` 文件和 UTF-8 ZIP，使用项目导唱、歌手标记及 Emoji 声明，附带透明占位图片。Ruby 绝对端点先量化，齐平时省略 reading 尾标签。碰撞、时间范围与所选输出问题由同一准备函数返回。

`output-validation.ts` 与各格式准备函数共享检查，问题携带稳定对象 ID、类别及严重度。`format-description.ts` 描述当前选择的表达差异。正式输出执行实际格式校验，草稿保存保留可继续编辑的状态。

## HTTP

`http/client.ts` 处理会话、CSRF 与错误；专用适配器管理读音、对齐、任务、来源和发布。`generated.ts` 从仓库 OpenAPI 生成，`validate.ts` 在使用边界校验所需响应。媒体打包以保存返回的确切 revision 为输入，归档与源音频由服务资源接口交付。


`preferences.ts` 将长期偏好映射到服务端 settings 字段，以 ETag 和逐字段原值检查处理并发修改；旧 localStorage 白名单仅导入一次。`playback-speed.ts` 承担读取播放速度的副作用。恢复 IndexedDB 与 sessionStorage 应用意图按 library ID 隔离，偏好加载完成后才挂载依赖初始值的编辑器。
