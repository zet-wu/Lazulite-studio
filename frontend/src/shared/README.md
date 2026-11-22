# Shared：通用界面与基础工具

共享层提供跨页面复用的主题样式、图标、表单控件与基础工具，不包含业务领域逻辑。

- **样式与主题**：`tokens.css` 定义紧凑桌面布局的语义色、字号、间距、圆角与明暗主题，组件布局使用 CSS Modules。
- **按钮与图标**：`Controls` 通过 `data-role` 声明主操作、次要操作、行内辅助与危险操作；`Icon` 基于 Lucide SVG 提供统一图标（许可随 `public/third-party/lucide-LICENSE.txt` 分发），`IconButton` 提供固定尺寸、可访问名称与轻量提示。
- **表单与设置**：`SettingsFields`、`BooleanField` 与 `Select` 统一设置行布局、三态复选框、键盘导航和就近错误提示；长卡片与管理表格共享紧凑样式。
- **弹层与反馈**：`Tooltip`、`ContextMenu`、`Disclosure` 与对话框基座统一视口定位、焦点圈定和键盘退出；`MessageBar` 管理常驻状态与可关闭的通知消息。
- **基础工具**：`measure-text.ts` 提供当前字体的文字测宽，`download.ts` 提供统一的浏览器 Blob 下载辅助。
