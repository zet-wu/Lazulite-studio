# App：组合与应用生命周期

后续负责启动、路由、providers、会话恢复、错误边界、工作区布局和适配器注入。项目切换显式处理未保存状态与媒体资源释放。

主路由为 `/projects`、`/projects/:projectId/edit`、`/projects/:projectId/export`，辅以登录和设置。编辑面板切换保持同一文档与播放器实例。

可依赖 features、domain、adapters、shared；不在这里实现歌词校验、XML 解析或自动化算法。

## 当前实现

S1 已增加启动、路由、Query provider、错误边界与只读页面组装。编辑会话和媒体生命周期仍待后续阶段。
