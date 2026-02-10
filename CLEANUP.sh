#!/bin/bash
# 清理项目，减少磁盘占用

echo "🧹 开始清理项目..."

# 清理 node_modules (可以通过 npm install 重新安装)
echo "删除 node_modules..."
rm -rf frontend/node_modules
rm -rf backend/src/node_modules  
rm -rf backend/src/matching/node_modules

# 清理构建产物
echo "删除构建产物..."
rm -rf frontend/.next
rm -rf frontend/dist
rm -rf backend/src/matching/dist

# 清理日志文件
echo "清理日志..."
rm -rf logs/*
rm -f backend/src/matching/*.log

# 清理备份文件
echo "删除备份文件..."
find . -name "*.backup" -delete
find . -name "*.bak" -delete

echo "✅ 清理完成！"
echo "现在项目应该只有约 50-100MB"
echo ""
echo "重新安装依赖："
echo "  cd frontend && npm install"
echo "  cd backend/src/matching && bun install"
