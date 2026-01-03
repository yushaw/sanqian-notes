# Sanqian Notes - 短期 TODO

## Daily Note（每日笔记）

每日记录功能，每天最多一条笔记。

### 数据层

- [ ] 笔记表新增 `type` 字段：`'note' | 'daily'`，默认 `'note'`
- [ ] 笔记表新增 `daily_date` 字段：格式 `'YYYY-MM-DD'`，唯一约束
- [ ] API: `getDailyByDate(date)` - 获取指定日期的 daily
- [ ] API: `createDaily(date)` - 创建指定日期的 daily
- [ ] API: `listDailyDates(year, month)` - 获取某月有 daily 的日期列表

### UI 层

- [ ] 侧边栏 Daily 入口
  - icon 显示当天日期数字（如 "1", "15", "31"）
  - 点击跳转到 Daily 视图并选中今天
  - 如果今天没有 daily 则自动创建
- [ ] DailyCalendar 组件
  - 使用 react-day-picker（轻量、可定制）
  - 月份切换 + "今天" 快捷按钮
  - 有内容的日期显示标记点
- [ ] DailyView 组件
  - 顶部：日历组件
  - 底部：选中日期的 daily（或创建按钮）
- [ ] 支持回填历史日期

### 逻辑

- [ ] 空内容自动删除：daily 创建后如果没有输入任何内容，切换日期或关闭时自动删除
- [ ] 每日唯一性：同一天只能有一条 daily

### 模板（后续）

- [ ] Daily 创建时可选择模板
- [ ] 预设模板：日程、反思、自由记录等
- [ ] 模板管理界面

---

## sanqian-chat 配置接口

让宿主应用（Notes）通过统一接口配置 chat 的外观和行为，实现内部自洽。

### 配置项

- [ ] `logo` - 应用 logo（图片 URL 或 ReactNode）
- [ ] `theme` - 主题模式（light / dark / auto）
- [ ] `accentColor` - 主题色
- [ ] `locale` / `strings` - 语言/文案配置
- [ ] `onClose` - 关闭窗口回调
- [ ] `onPin` / `alwaysOnTop` - 置顶控制
- [ ] `windowControls` - 是否显示窗口控制按钮（pin/close）

### 实现方式

- [ ] CompactChat 新增 `config` prop 统一配置
- [ ] 内部处理 logo 样式（尺寸、暗色模式 invert 等）
- [ ] 内部处理主题色 CSS 变量覆盖

---

## 其他待办

<!-- 后续补充 -->
