# 数据库重置指南 / Database Reset Guide

## 📍 数据库位置 / Database Location

散墨笔记的数据库文件存储位置：

- **macOS**: `~/Library/Application Support/Sanqian Notes/notes.db`
- **Windows**: `%APPDATA%\Sanqian Notes\notes.db`
- **Linux**: `~/.config/Sanqian Notes/notes.db`

## 🔄 重置方法 / Reset Methods

### 方法 1：使用脚本（推荐）/ Method 1: Use Script (Recommended)

在项目根目录执行：

```bash
npm run reset-db
```

或者直接执行脚本：

```bash
bash scripts/reset-database.sh
```

**功能特性：**
- ✅ 自动备份到桌面（带时间戳）
- ✅ 交互式确认，避免误操作
- ✅ 清理所有 SQLite 临时文件（.db, .db-wal, .db-shm）
- ✅ 中英文双语提示

### 方法 2：手动删除 / Method 2: Manual Deletion

**macOS / Linux:**
```bash
rm -rf ~/Library/Application\ Support/Sanqian\ Notes/
```

**Windows (PowerShell):**
```powershell
Remove-Item "$env:APPDATA\Sanqian Notes" -Recurse -Force
```

### 方法 3：仅删除数据库文件 / Method 3: Delete Database File Only

保留应用设置，仅删除笔记数据：

**macOS:**
```bash
rm ~/Library/Application\ Support/Sanqian\ Notes/notes.db*
```

**Windows:**
```cmd
del "%APPDATA%\Sanqian Notes\notes.db*"
```

## ⚠️ 重要提示 / Important Notes

1. **数据不可恢复**：删除数据库后，所有笔记将永久丢失（除非有备份）
2. **关闭应用**：执行重置前请先完全关闭散墨笔记应用
3. **自动备份**：使用 `npm run reset-db` 脚本会自动创建备份到桌面
4. **重新启动**：删除后重启应用，会自动创建新的空数据库并显示欢迎笔记

## 🗄️ 数据库结构 / Database Schema

散墨笔记使用 SQLite 数据库，包含以下表：

- `notebooks` - 笔记本
- `notes` - 笔记内容
- `tags` - 标签
- `note_tags` - 笔记-标签关联
- `note_links` - 笔记链接（双链）

## 💾 备份建议 / Backup Recommendations

在重置前，建议手动备份数据库文件：

```bash
# macOS
cp ~/Library/Application\ Support/Sanqian\ Notes/notes.db ~/Desktop/notes-backup-$(date +%Y%m%d).db

# Windows (PowerShell)
Copy-Item "$env:APPDATA\Sanqian Notes\notes.db" "$env:USERPROFILE\Desktop\notes-backup-$(Get-Date -Format 'yyyyMMdd').db"
```

## 🔧 开发调试 / Development & Debugging

如果在开发过程中需要频繁重置数据库：

1. 使用脚本：`npm run reset-db`
2. 或手动删除开发环境的数据库文件
3. 重新运行 `npm run dev`，应用会自动创建新数据库

## 📱 应用第一次启动 / First Launch

删除数据库后，应用第一次启动时会：

1. 自动创建新的空数据库
2. 初始化数据库表结构
3. 创建一个欢迎笔记（包含使用指南）
4. 恢复到全新安装状态

## 🆘 故障排除 / Troubleshooting

### 脚本执行失败
- 检查脚本权限：`chmod +x scripts/reset-database.sh`
- 确保 bash 可用（macOS/Linux 内置）

### 找不到数据库文件
- 应用可能还没有运行过
- 检查应用名称是否为 "Sanqian Notes"
- 使用 `find` 命令搜索：`find ~/Library/Application\ Support -name "notes.db"`

### 删除后应用报错
- 完全退出应用（包括托盘图标）
- 重新启动应用
- 如果问题持续，尝试删除整个应用数据目录
