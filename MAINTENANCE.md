# S123 抽奖系统 — 维护文档

> 最后更新：2026-06-16

---

## 一、系统概览

S123 HOMME 抖音直播电商抽奖系统。顾客凭快麦订单号（tid）参与抽奖，中奖后截图凭证，客服核销兑奖。

**线上地址：** https://lottery.s123vip.com  
**GitHub：** https://github.com/ZondaTse/s123lottery

---

## 二、服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 119.91.45.151 |
| 系统 | OpenCloudOS（腾讯云广州） |
| 抽奖程序端口 | **3003** |
| 进程管理 | PM2，进程名 `s123lottery`（id: 5） |
| 工作目录 | `/root/s123/` |
| 数据库 | `/root/s123/lottery.db`（SQLite） |
| 入口文件 | `/root/s123/server.mjs` |
| PM2 配置 | `/root/s123/ecosystem.config.cjs` |

### 其他 PM2 进程（同服务器）
| id | 名称 | 端口 |
|----|------|------|
| 1 | qjd-tracker | 3001 |
| 4 | s123（S123 OS 中台） | 3002 |
| 5 | s123lottery | 3003 |

---

## 三、Nginx 配置

文件：`/etc/nginx/conf.d/s123lottery.conf`

```nginx
server {
    listen 80;
    server_name lottery.s123vip.com;
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

## 四、DNS

服务商：腾讯云 DNSPod，域名 `s123vip.com`

| 主机记录 | 类型 | 记录值 |
|---------|------|--------|
| lottery | A | 119.91.45.151 |

---

## 五、快麦 ERP 集成

| 项目 | 值 |
|------|-----|
| AppKey | `25795669` |
| Secret | `c8a3cfaef38b4efd814eae9d2f2260b9` |
| Session | `e7af4f59706d452fa44f85c8cdf4d767`（到期 2026-07-03） |
| 网关 | `https://gw.superboss.cc/router` |
| 接口 | `erp.trade.list.query` |

**同步逻辑：**
- 顾客每次点击抽奖时，自动拉取快麦增量订单
- 以平台订单号（tid）为抽奖核验号
- 活动时间窗口：2026-05-01 ～ 2026-12-31
- 退款订单（`TRADE_CLOSED`）自动标记 `used=-1`，无法参与抽奖

> ⚠️ Session Token 到期后需要在快麦后台重新获取，更新 `/root/s123/ecosystem.config.cjs` 里的 `KM_SESSION`，然后 `pm2 restart s123lottery`。

---

## 六、飞书通知

Webhook：`https://open.feishu.cn/open-apis/bot/v2/hook/2c33e97a-4e1f-4be9-a3c9-bc8f11a7c8b8`

触发时机：
- **中奖时** → 发送订单号、奖项、时间
- **兑奖时** → 发送订单号、奖项、核销人、时间

---

## 七、奖项配置（默认值）

可在后台管理页面修改，以下为代码默认值：

| 奖项 | 概率 | 名额 |
|------|------|------|
| 特等奖 iPhone17 | 1% | 1 |
| 一等奖 现金999 | 2% | 3 |
| 二等奖 AirPods4 | 4% | 5 |
| 三等奖 盲盒 | 8% | 50 |
| 四等奖 香水 | 15% | 不限 |
| 五等奖 半价衣服 | 30% | 不限 |
| 六等奖 优惠券10元 | 40% | 不限 |

---

## 八、后台管理

1. 打开 https://lottery.s123vip.com
2. 点击页面右上角齿轮图标
3. 输入管理密码进入后台

后台功能：修改奖项配置、查看中奖记录、核销兑奖、手动导入订单、修改密码

---

## 九、数据库结构

```sql
CREATE TABLE orders (
  code        TEXT PRIMARY KEY,   -- 订单号（快麦 tid）
  platform    TEXT DEFAULT '',    -- 平台来源
  shop        TEXT DEFAULT '',
  order_time  TEXT DEFAULT '',
  used        INTEGER DEFAULT 0,  -- 0=未抽 1=已抽 -1=已退款
  prize       TEXT DEFAULT '',
  draw_time   TEXT DEFAULT '',
  secret      TEXT DEFAULT '',    -- 防伪码
  redeemed    INTEGER DEFAULT 0,
  redeem_time TEXT DEFAULT '',
  operator    TEXT DEFAULT ''     -- 核销人
);

CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT
);
```

---

## 十、常用运维命令

```bash
# SSH 进服务器
ssh root@119.91.45.151

# 查看进程状态
pm2 list

# 重启抽奖程序
pm2 restart s123lottery

# 查看实时日志
pm2 logs s123lottery

# 从 GitHub 拉取最新代码并重启
curl -o /root/s123/server.mjs https://raw.githubusercontent.com/ZondaTse/s123lottery/main/server.mjs && pm2 restart s123lottery

# 重置测试订单（可反复测试用）
sqlite3 /root/s123/lottery.db "UPDATE orders SET used=0, prize=NULL, draw_time=NULL, secret=NULL, redeemed=0, redeem_time=NULL WHERE code='TEST_DEMO';"

# 查看最近中奖记录
sqlite3 /root/s123/lottery.db "SELECT code, prize, draw_time, redeemed FROM orders WHERE used=1 ORDER BY draw_time DESC LIMIT 10;"

# 查看退款订单
sqlite3 /root/s123/lottery.db "SELECT code, order_time FROM orders WHERE used=-1 LIMIT 10;"

# 重载 Nginx 配置
nginx -t && nginx -s reload

# 更新快麦 Session（到期后）
sed -i 's/KM_SESSION: .*/KM_SESSION: '"'"'新token'"'"',/' /root/s123/ecosystem.config.cjs && pm2 restart s123lottery --update-env
```

---

## 十一、GitHub 部署

- **Repo：** https://github.com/ZondaTse/s123lottery
- **主分支：** main
- 服务器不做自动部署，更新需手动拉取（见上方 curl 命令）

---

## 十二、已知注意事项

1. **EdgeOne Pages 已废弃**：原来的边缘函数架构已放弃，现在完全跑在服务器上。EdgeOne 上的 `s123lottery` Pages 项目可以保留或删除，不影响当前运行。
2. **端口不要冲突**：3001 是 qjd-tracker，3002 是 s123 中台，抽奖用 3003。
3. **`git pull` 在服务器上可能卡住**，用 `curl` 直接拉 raw 文件更可靠。
4. **快麦 Session** 2026-07-03 到期，需提前续期。
