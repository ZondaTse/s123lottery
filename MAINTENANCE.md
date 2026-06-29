# S123 抽奖系统 — 维护文档

> 最后更新：2026-06-28

---

## 一、系统概览

S123 HOMME 抖音直播电商抽奖系统。顾客凭快麦订单号（tid）参与抽奖，中奖后截图凭证，客服核销兑奖。

**线上地址：** https://lottery.s123vip.com  
**备案号：** 粤ICP备2026075037号  
**GitHub：** https://github.com/ZondaTse/s123lottery

---

## 二、服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 119.91.45.151 |
| 系统 | OpenCloudOS（腾讯云广州） |
| 抽奖程序端口 | **3003** |
| 进程管理 | PM2，进程名 `s123lottery`（id: 6） |
| **工作目录** | `/root/s123/s123lottery-tmp/`（⚠️ 不是 `/root/s123/`） |
| 数据库 | `/root/s123/lottery.db`（SQLite，WAL 模式） |
| 入口文件 | `/root/s123/s123lottery-tmp/server.mjs` |
| PM2 配置 | `/root/s123/s123lottery-tmp/ecosystem.config.cjs` |

### 其他 PM2 进程（同服务器）

| id | 名称 | 状态 | 备注 |
|----|------|------|------|
| 0 | qjd-tracker | online | 端口 3001 |
| 1 | s123 | errored | S123 中台，Node 22，端口 3002 |
| 5 | openclaw | online | 独立服务 |
| 6 | s123lottery | **online** | 端口 3003，Node 20 |

### SSH 登录

```bash
# 免密登录（已部署 ED25519 密钥）
ssh -i ~/.ssh/id_ed25519_s123 root@119.91.45.151

# 或直接（若本机默认密钥已包含）
ssh root@119.91.45.151
```

---

## 三、⚠️ Node.js 版本注意事项

服务器同时安装了两个 Node 版本：

| 版本 | 路径 | 用途 |
|------|------|------|
| Node 20.20.0 | `/usr/bin/node-20` | **s123lottery 专用** |
| Node 22.x | `/usr/local/bin/node`（系统默认） | s123 中台 |

**s123lottery 必须使用 Node 20 运行**（better-sqlite3 编译到 Node 20 的 MODULE_VERSION 115）。

凡是操作 `/root/s123/s123lottery-tmp/` 下的依赖，必须显式指定 Node 20：

```bash
# 安装依赖
/usr/bin/node-20 /usr/bin/npm-20 install

# 重新编译 native 模块
PATH=/tmp/node20bin:$PATH /usr/bin/node-20 /usr/bin/npm-20 rebuild better-sqlite3 --build-from-source
# （其中 /tmp/node20bin/node 是指向 /usr/bin/node-20 的软链接）

# 绝对不能用裸命令 npm install / npm rebuild（会用 Node 22，导致启动崩溃）
```

---

## 四、Nginx 配置

文件：`/etc/nginx/conf.d/s123lottery.conf`

```nginx
server {
    listen 443 ssl;
    server_name lottery.s123vip.com;
    # SSL 证书配置由腾讯云自动托管
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 五、DNS

服务商：腾讯云 DNSPod，域名 `s123vip.com`

| 主机记录 | 类型 | 记录值 |
|---------|------|--------|
| lottery | A | 119.91.45.151 |

---

## 六、快麦 ERP 集成

| 项目 | 值 |
|------|-----|
| AppKey | `25795669` |
| Secret | `c8a3cfaef38b4efd814eae9d2f2260b9` |
| Session | `e7af4f59706d452fa44f85c8cdf4d767`（⚠️ 到期 2026-07-03） |
| 网关 | `https://gw.superboss.cc/router` |
| 接口 | `erp.trade.list.query` |

**同步逻辑：**
- 系统每小时自动同步一次快麦订单（定时触发 `/api/sync`）
- 顾客每次点击抽奖时也会触发一次增量同步
- 以平台订单号（tid）为抽奖核验号
- 活动时间窗口：2026-05-01 ～ 2026-12-31
- 仅已发货/交易完成的订单入库；退款订单标记 `used=-1`，无法参与抽奖

> ⚠️ **Session Token 2026-07-03 到期**，需要在快麦后台重新获取，更新 `/root/s123/s123lottery-tmp/ecosystem.config.cjs` 里的 `KM_SESSION`，然后 `pm2 restart s123lottery --update-env`。

---

## 七、Excel 订单导入（手动上传）

后台管理页面支持手动上传 Excel / CSV 订单文件（xlsx 解析在本地浏览器完成）。

**注意事项：**
- xlsx.full.min.js（862KB）已下载到服务器本地 `/root/s123/s123lottery-tmp/xlsx.full.min.js`，不从 CDN 加载（CDN 在国内可能被屏蔽）
- 支持列名识别：订单号、平台来源、店铺、下单时间、**订单状态**
- 自动过滤退款/关闭订单（`交易关闭`、`已关闭`、`退款`、`trade_closed`、`closed`），这些订单会被加入退款列表发送给服务端
- 服务端收到退款订单列表后，将数据库中 `used=0` 的退款订单标记为 `used=-1`（已中奖的不覆盖）
- 批量上传，每批 500 条

---

## 八、密码体系

| 用途 | 默认值 | 修改方式 |
|------|--------|---------|
| 参数管理密码（后台登录 + 导入订单） | `123123` | 后台「密码管理」→「修改参数管理密码」 |
| 客服兑奖密码 | `kefu123` | 后台「密码管理」→「修改客服兑奖密码」 |
| 管理员入口密码（连点10次触发） | `s123admin` | 直接修改 `index.html` 里的 `ADMIN_PW` 变量 |

密码持久化存储在 SQLite `config` 表中，重启后有效。

---

## 九、奖项配置（代码默认值）

可在后台管理页面实时修改，无需重启。

| 奖项 | 概率权重 | 名额 |
|------|---------|------|
| 特等奖 iPhone17 | 1 | 1 |
| 一等奖 现金999 | 2 | 3 |
| 二等奖 AirPods4 | 4 | 5 |
| 三等奖 盲盒 | 8 | 50 |
| 四等奖 香水 | 15 | 不限 |
| 五等奖 半价衣服 | 30 | 不限 |
| 六等奖 优惠券10元 | 40 | 不限 |

> 概率权重支持小数（精度到小数点后2位）。名额耗尽后自动顺延到下一档。

---

## 十、数据库结构

位置：`/root/s123/lottery.db`

```sql
CREATE TABLE orders (
  code        TEXT PRIMARY KEY,   -- 订单号（快麦 tid），统一大写
  platform    TEXT DEFAULT '',    -- 平台来源（淘宝/抖音等）
  shop        TEXT DEFAULT '',    -- 店铺
  order_time  TEXT DEFAULT '',    -- 下单时间（北京时间）
  used        INTEGER DEFAULT 0,  -- 0=未抽 | 1=已中奖 | -1=退款禁止参与
  prize       TEXT DEFAULT '',    -- 奖项名称
  draw_time   TEXT DEFAULT '',    -- 抽奖时间
  secret      TEXT DEFAULT '',    -- 6位防伪码（兑奖用）
  redeemed    INTEGER DEFAULT 0,  -- 0=未核销 | 1=已核销
  redeem_time TEXT DEFAULT '',    -- 核销时间
  operator    TEXT DEFAULT '',    -- 核销人
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT
  -- 常用 key：config:prizes, config:managepw, config:adminpw,
  --           sync:cursor, sync:lastStatus, config:cronkey
);
```

---

## 十一、API 接口一览

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/draw` | 顾客抽奖（含快麦同步） |
| GET  | `/api/config` | 读取奖项配置 |
| POST | `/api/config` | 保存奖项配置（需管理密码） |
| POST | `/api/import` | 手动导入订单（需管理密码） |
| POST | `/api/sync`   | 触发快麦同步（需 cronkey） |
| GET  | `/api/sync?status=1` | 查询上次同步状态 |
| GET  | `/api/query?code=xxx` | 查询订单中奖状态 |
| POST | `/api/winners` | 查看所有中奖记录（需管理密码） |
| POST | `/api/redeem` | 核销兑奖（需客服密码） |
| POST | `/api/changepw` | 修改密码 |

---

## 十二、常用运维命令

```bash
# 查看进程状态
pm2 list

# 重启抽奖程序
pm2 restart s123lottery

# 查看实时日志
pm2 logs s123lottery

# 查看最近中奖记录
sqlite3 /root/s123/lottery.db \
  "SELECT code, prize, draw_time, redeemed FROM orders WHERE used=1 ORDER BY draw_time DESC LIMIT 20;"

# 查看退款被禁止的订单
sqlite3 /root/s123/lottery.db \
  "SELECT code, order_time FROM orders WHERE used=-1 ORDER BY created_at DESC LIMIT 10;"

# 查询数据库总体情况
sqlite3 /root/s123/lottery.db \
  "SELECT used, COUNT(*) cnt FROM orders GROUP BY used;"

# 重置测试订单
sqlite3 /root/s123/lottery.db \
  "UPDATE orders SET used=0, prize='', draw_time='', secret='', redeemed=0, redeem_time='' WHERE code='TEST_DEMO';"

# 更新快麦 Session（Token 到期后）
# 1. 修改 ecosystem.config.cjs 里的 KM_SESSION
nano /root/s123/s123lottery-tmp/ecosystem.config.cjs
# 2. 重启并载入新环境变量
pm2 restart s123lottery --update-env

# 重载 Nginx 配置
nginx -t && nginx -s reload

# 备份数据库
cp /root/s123/lottery.db /root/s123/lottery.db.bak.$(date +%Y%m%d)
```

---

## 十三、文件结构

```
/root/s123/s123lottery-tmp/     ← 抽奖服务根目录
├── server.mjs                  ← Node.js 服务（HTTP + SQLite + 快麦同步）
├── index.html                  ← 前端单页面（含转盘、后台管理）
├── xlsx.full.min.js            ← Excel 解析库（本地，避免 CDN 被屏蔽）
├── ecosystem.config.cjs        ← PM2 配置（含快麦凭证、Node 20 解释器）
├── package.json
└── node_modules/               ← 独立 node_modules（与 s123 中台隔离）
    └── better-sqlite3/         ← 已用 Node 20 编译

/root/s123/lottery.db           ← 数据库（不在 tmp 目录，持久保存）
```

> ⚠️ **工作目录是 `/root/s123/s123lottery-tmp/`**，不是 `/root/s123/`。  
> 数据库路径单独在 `/root/s123/lottery.db`（重部署不会丢失数据）。

---

## 十四、后台管理入口

1. 打开 https://lottery.s123vip.com
2. 连续快速点击页面中的触发区域 **10次**
3. 输入管理员密码（默认 `s123admin`）进入后台

后台功能：
- 修改奖项名称、概率、名额
- 查看所有中奖记录
- 导入 Excel 订单（支持退款过滤）
- 手动触发快麦同步
- 修改参数管理密码 / 客服兑奖密码

---

## 十五、飞书通知

Webhook：`https://open.feishu.cn/open-apis/bot/v2/hook/2c33e97a-4e1f-4be9-a3c9-bc8f11a7c8b8`

触发时机：
- **中奖时** → 发送订单号、奖项、时间
- **兑奖时** → 发送订单号、奖项、核销人、时间

---

## 十六、已知注意事项 & 踩坑记录

1. **Node 版本必须隔离**：s123lottery 用 Node 20，s123 中台用 Node 22。两套 node_modules 完全隔离（`/root/s123/s123lottery-tmp/node_modules`），绝对不能混用 npm 命令。

2. **修改 index.html 不能用 sed 插入中文**：历史上用 Python/sed 脚本修改 HTML 时，中文引号被替换为 Unicode 智能引号（`\xe2\x80\x9c` / `\xe2\x80\x9d`），导致整段 JS 解析失败、转盘不显示。正确做法：在本地修改后通过 `scp` 上传。

3. **xlsx.full.min.js 必须本地化**：国内访问 Cloudflare CDN 不稳定，Excel 解析库已下载到服务器本地，前端 `<script src="/xlsx.full.min.js">` 由 server.mjs 直接提供。

4. **快麦 Session 2026-07-03 到期**：需提前在快麦后台续期，更新 `ecosystem.config.cjs`。

5. **数据库不在工作目录**：`lottery.db` 在 `/root/s123/lottery.db`，重部署或替换 `s123lottery-tmp` 目录不会丢失数据。

6. **端口分配**：3001 = qjd-tracker，3002 = s123 中台，3003 = s123lottery，不得冲突。

7. **git pull 在服务器可能卡住**：建议在本地修改后 scp 上传，或用 `curl` 拉 raw 文件。

---

## 十七、本地开发

```bash
# 克隆仓库
git clone https://github.com/ZondaTse/s123lottery.git
cd s123lottery

# 安装依赖（本地用系统 node 即可）
npm install

# 启动开发服务
node server.mjs
# 访问 http://localhost:3000

# 部署到服务器
scp -i ~/.ssh/id_ed25519_s123 server.mjs index.html root@119.91.45.151:/root/s123/s123lottery-tmp/
ssh -i ~/.ssh/id_ed25519_s123 root@119.91.45.151 "pm2 restart s123lottery"
```
