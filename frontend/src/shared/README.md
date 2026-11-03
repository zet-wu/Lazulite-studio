# Shared：通用界面与工具

共享层提供通用控件与显示工具，业务规则由 domain 和 features 管理。`tokens.css` 定义紧凑桌面的语义颜色、文字、间距、圆角及明暗主题；组件布局由 CSS Modules 表达。

`Controls` 中的按钮通过 `data-role` 声明 primary、secondary、inline、danger 或 danger-primary，选中态使用 ARIA 属性。`Icon` 的通用图形采用 Lucide SVG，使用 24×24 坐标、统一描边与圆角，卡拉 OK 标识及打轴标记使用专用图形。Lucide／Feather 完整许可随 `public/third-party/lucide-LICENSE.txt` 发布。IconButton 组合可访问名称、悬停与键盘提示，并使用固定尺寸居中显示；BooleanField 使用原生 checkbox 支持开关与三态。

`Select` 根据实际弹层尺寸及视口空间定位，保留键盘和焦点行为；歌词引用采用独立文本层级。`Disclosure` 管理按需挂载与 ARIA 关联，`MessageBar` 管理持续状态和事件反馈呈现（可选操作、关闭与时效），事件对象区分同文案的不同发布；关闭收起本次事件和操作，计时器随事件清理，键盘焦点在栏内时暂停自动关闭，`measure-text` 提供当前字体的文字测宽。对话框统一内容滚动、固定操作区、焦点圈定与返回。

`Tooltip` 提供带持续可访问描述的轻量说明：鼠标延迟、键盘即时显示、操作收起及视口定位。`ContextMenu` 提供歌词和音频片段共用的 portal 外壳、实际尺寸定位、可用项导航和关闭焦点策略，动作与业务选区由调用方提供。
