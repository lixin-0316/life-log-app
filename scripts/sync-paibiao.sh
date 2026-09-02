#!/bin/bash
# 烬羽阁 paibiao 同步脚本 v3 —— 多源下载 + GitHub API 兜底 + 内容校验
# 用法: bash ~/sync-paibiao.sh [commit号]   （不传用默认号）
cd /opt/apps/life-log-app || { echo "目录不存在: /opt/apps/life-log-app"; exit 1; }
SHA=${1:-5ad3f6f}
REPO="lixin-0316/life-log-app"
FAIL=0

# 1) 若是 git 仓库，优先 git pull
if [ -d .git ]; then
  echo "[git] 检测到 git 仓库，执行 git pull ..."
  git pull -q && echo "git pull OK" && pm2 restart all && exit 0
fi

# GitHub API 下载（最可靠，base64 返回，不被墙）
api_get(){ # $1=仓库内路径 $2=输出文件 $3=校验关键词
  curl -s "https://api.github.com/repos/$REPO/contents/$1?ref=$SHA" | node -e \
    "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(j.content){process.stdout.write(Buffer.from(j.content,'base64'))}else{process.exit(1)}})" > "$2" 2>/dev/null
  grep -q "$3" "$2" && return 0 || return 1
}

# 2) server.js
cp server.js server.js.bak 2>/dev/null
OK=0
for u in \
  "https://cdn.jsdelivr.net/gh/$REPO@$SHA/server.js" \
  "https://raw.githubusercontent.com/$REPO/$SHA/server.js" \
  "https://gitclone.com/github.com/$REPO/raw/$SHA/server.js"; do
  echo "[server.js] 尝试: $u"
  if curl -sL --max-time 60 -o server.js "$u" && grep -q "express" server.js; then echo "[server.js] OK"; OK=1; break; fi
done
if [ $OK -eq 0 ]; then echo "[server.js] 尝试 GitHub API ..."; api_get "server.js" server.js "express" && { echo "[server.js] API OK"; OK=1; }; fi
if [ $OK -eq 0 ]; then echo "[server.js] 全部失败，还原备份"; cp server.js.bak server.js; FAIL=1; fi

# 3) paibiao.html
OK=0
for u in \
  "https://cdn.jsdelivr.net/gh/$REPO@$SHA/public/paibiao.html" \
  "https://raw.githubusercontent.com/$REPO/$SHA/public/paibiao.html" \
  "https://gitclone.com/github.com/$REPO/raw/$SHA/public/paibiao.html"; do
  echo "[paibiao.html] 尝试: $u"
  if curl -sL --max-time 60 -o public/paibiao.html "$u" && head -c 9 public/paibiao.html | grep -q '<!DOCTYPE'; then echo "[paibiao.html] OK"; OK=1; break; fi
done
if [ $OK -eq 0 ]; then echo "[paibiao.html] 尝试 GitHub API ..."; api_get "public/paibiao.html" public/paibiao.html "<!DOCTYPE" && { echo "[paibiao.html] API OK"; OK=1; }; fi
[ $OK -eq 0 ] && echo "[paibiao.html] 全部失败!" && FAIL=1

pm2 restart all
echo "------------------------"
if [ $FAIL -eq 0 ]; then echo "✓ 同步成功"; else echo "✗ 有文件失败，见上方"; fi
echo "验证:"
curl -s --max-time 8 http://localhost:3456/api/paibiao; echo
curl -s -o /dev/null -w "paibiao 页面 HTTP:%{http_code}\n" --max-time 8 http://localhost:3456/paibiao.html
