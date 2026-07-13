# 随手记 · 多人版

个人生活记录 & 待办管理工具，支持多用户、手机号注册/登录、管理员查看全员记录。

## 功能

- 📱 手机号注册 + 短信验证码（开发模式：验证码显示在页面上）
- 🔐 JWT 登录认证（30 天有效）
- 👑 管理员可切换「查看全员」模式
- 📋 五种记录类型：待办 / 趣事 / 会议 / 纪念日 / 通用
- 📅 日历视图 + 记录袋（按日期浏览）
- 🔍 搜索 + 类型筛选
- ✅ 待办可勾选完成
- 💾 SQLite 数据库持久化存储

## 技术栈

- 后端：Node.js + Express + better-sqlite3 + JWT
- 前端：纯 HTML/CSS/JS（无框架）
- 数据库：SQLite（单文件，零配置）

## 本地运行

```bash
npm install
npm start
# 打开 http://localhost:3456
```

- 默认管理员：`admin` / `admin123`（从登录页底部「管理员入口」进入）
- 开发模式验证码：发送后直接显示在页面上

## 部署到 Railway

1. Fork/推送本仓库到你的 GitHub
2. 打开 [railway.app](https://railway.app)，用 GitHub 登录
3. 点击 **New Project → Deploy from GitHub repo**
4. 选择本仓库，Railway 自动部署
5. 在项目设置里添加环境变量：
   - `JWT_SECRET` — 一个随机字符串（如 `my-super-secret-key-2024`）
   - `NODE_ENV` — 设为 `production`（生产模式不返回验证码明文）
6. 部署完成后，Railway 会生成一个域名（如 `xxx.up.railway.app`）

## 接入真实短信服务

替换 `server.js` 中的 `sendSMS()` 函数，接入阿里云短信 / 腾讯云短信 / 互亿无线等。

```js
async function sendSMS(phone, code) {
  // 示例：阿里云短信
  // await aliSMS.send({ PhoneNumbers: phone, TemplateCode: 'SMS_xxx', TemplateParam: { code } });
  console.log(`[SMS] ${phone} -> ${code}`);
  return true;
}
```

## 许可证

MIT
