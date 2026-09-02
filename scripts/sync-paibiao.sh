#!/bin/bash
# 烬羽阁 paibiao 同步脚本 v2 —— 多源下载 + 内容校验，防止下到跳转提示文本
# 用法: bash ~/sync-paibiao.sh
# 更新时把 SHA 换成最新 commit 短号（我推送后会告诉你）
cd /opt/apps/life-log-app || { echo "目录不存在: /opt/apps/life-log-app"; exit 1; }
SHA=${1:-a0b0493}
FAIL=0

# 1) 若该目录是 git 仓库，优先 git pull（最可靠）
if [ -d .git ]; then
  echo "[git] 检测到 git 仓库，执行 git pull ..."
  git pull -q && echo "git pull OK" && pm2 restart all && exit 0
fi

# 2) server.js：先备份，再多源尝试，校验必须包含 express
cp server.js server.js.bak 2>/dev/null
OK=0
for u in \
  "https://cdn.jsdelivr.net/gh/lixin-0316/life-log-app@$SHA/server.js" \
  "https://raw.githubusercontent.com/lixin-0316/life-log-app/$SHA/server.js" \
  "https://gitclone.com/github.com/lixin-0316/life-log-app/raw/$SHA/server.js"; do
  echo "[server.js] 尝试: $u"
  if curl -sL --max-time 90 -o server.js "$u" && grep -q "express" server.js; then
    echo "[server.js] OK"; OK=1; break
  fi
done
if [ $OK -eq 0 ]; then echo "[server.js] 下载失败，已还原备份"; cp server.js.bak server.js; FAIL=1; fi

# 3) paibiao.html：校验必须以 <!DOCTYPE 开头
OK=0
for u in \
  "https://cdn.jsdelivr.net/gh/lixin-0316/life-log-app@$SHA/public/paibiao.html" \
  "https://raw.githubusercontent.com/lixin-0316/life-log-app/$SHA/public/paibiao.html" \
  "https://gitclone.com/github.com/lixin-0316/life-log-app/raw/$SHA/public/paibiao.html"; do
  echo "[paibiao.html] 尝试: $u"
  if curl -sL --max-time 90 -o public/paibiao.html "$u" && head -c 9 public/paibiao.html | grep -q '<!DOCTYPE'; then
    echo "[paibiao.html] OK"; OK=1; break
  fi
done
[ $OK -eq 0 ] && echo "[paibiao.html] 下载失败!" && FAIL=1

pm2 restart all
echo "------------------------"
if [ $FAIL -eq 0 ]; then echo "✓ 同步成功"; else echo "✗ 有文件失败，见上方"; fi
echo "验证:"
curl -s --max-time 8 http://localhost:3456/api/paibiao; echo
curl -s -o /dev/null -w "paibiao 页面 HTTP:%{http_code}\n" --max-time 8 http://localhost:3456/paibiao.html
