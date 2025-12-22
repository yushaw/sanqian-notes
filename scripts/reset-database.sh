#!/bin/bash
# 重置散墨笔记数据库 - 恢复出厂设置
# Reset Sanqian Notes database - Restore to factory defaults

set -e

# 数据库路径
DB_DIR="$HOME/Library/Application Support/Sanqian Notes"
DB_FILE="$DB_DIR/notes.db"
DB_WAL="$DB_DIR/notes.db-wal"
DB_SHM="$DB_DIR/notes.db-shm"

echo "========================================="
echo "  散墨笔记 - 数据库重置工具"
echo "  Sanqian Notes - Database Reset Tool"
echo "========================================="
echo ""

# 检查数据库目录是否存在
if [ ! -d "$DB_DIR" ]; then
  echo "✓ 数据库目录不存在，无需清理"
  echo "✓ Database directory does not exist, no cleanup needed"
  exit 0
fi

# 检查数据库文件是否存在
if [ ! -f "$DB_FILE" ]; then
  echo "✓ 数据库文件不存在，无需清理"
  echo "✓ Database file does not exist, no cleanup needed"
  exit 0
fi

# 显示将要删除的文件
echo "将删除以下文件 / Files to be deleted:"
ls -lh "$DB_DIR"/*.db* 2>/dev/null || true
echo ""

# 确认删除
read -p "确认删除数据库？这将永久删除所有笔记！[y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ 操作已取消"
  echo "❌ Operation cancelled"
  exit 0
fi

# 创建备份
BACKUP_DIR="$HOME/Desktop/sanqian-notes-backup-$(date +%Y%m%d-%H%M%S)"
echo ""
echo "📦 创建备份到桌面..."
echo "📦 Creating backup to Desktop..."
mkdir -p "$BACKUP_DIR"
cp "$DB_FILE" "$BACKUP_DIR/" 2>/dev/null || true
cp "$DB_WAL" "$BACKUP_DIR/" 2>/dev/null || true
cp "$DB_SHM" "$BACKUP_DIR/" 2>/dev/null || true

if [ -f "$BACKUP_DIR/notes.db" ]; then
  echo "✓ 备份已创建：$BACKUP_DIR"
  echo "✓ Backup created at: $BACKUP_DIR"
else
  echo "⚠️  备份失败，但继续执行"
  echo "⚠️  Backup failed, but continuing"
fi

# 删除数据库文件
echo ""
echo "🗑️  删除数据库文件..."
echo "🗑️  Deleting database files..."
rm -f "$DB_FILE" "$DB_WAL" "$DB_SHM"

echo ""
echo "✅ 数据库已重置！"
echo "✅ Database has been reset!"
echo ""
echo "下次启动应用时将创建新的数据库"
echo "A new database will be created on next app launch"
echo "========================================="
