# Domain：歌词编辑规则

后续包含 StudioLyricDocument、line/span/Ruby/agent、时间与文本坐标、校验、命令、撤销重做、提案适用性和服务端口定义。

运行时模型独立于 Lazulite 行级投影和 AMLL 展示模型。时间使用绝对整数微秒/null，文本范围使用 Unicode code point 半开区间；正文和读音坐标分开。稳定 ID 不依赖数组位置。

纯领域层不依赖 React、DOM、HTTP 或具体库后端。XML 保留信息使用平台无关表示，解析放在适配器。所有歌词修改具有原子事务和可逆语义，文本变化必须处理关联 Ruby、时间和复核信息失效。

## 当前实现

已增加 DOM 无关的 TTML 试验表示；尚未形成完整 StudioLyricDocument、可逆编辑命令和历史。
