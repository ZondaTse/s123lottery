/**
 * S123 HOMME 抽奖系统 · Node.js 服务端
 * 运行：node server.mjs
 * 依赖：better-sqlite3（npm install better-sqlite3）
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// 配置（可在此修改，或通过环境变量覆盖）
// ─────────────────────────────────────────────
const PORT            = process.env.PORT        || 3000;
const DB_PATH         = process.env.DB_PATH     || path.join(__dirname, 'lottery.db');
const KM_APPKEY       = process.env.KM_APPKEY   || '25795669';
const KM_SECRET       = process.env.KM_SECRET   || '';   // 填入快麦 secret
const KM_SESSION      = process.env.KM_SESSION  || '';   // 填入快麦 session
const KM_GATEWAY      = 'https://gw.superboss.cc/router';

const DEFAULT_MANAGE_PW = '123123';
const DEFAULT_REDEEM_PW = 'kefu123';
const ADMIN_ENTRY_PW    = 's123admin';   // 前端连点10次后的入口密码（在 index.html 里）

const EVENT_START_MS  = Date.parse('2026-05-01T00:00:00+08:00');
const EVENT_END_MS    = Date.parse('2026-12-31T23:59:59+08:00');

const DEFAULT_PRIZES = [
  { id: 0, name: '特等奖 iPhone17',   prob: 1,  quota: 1,    won: 0 },
  { id: 1, name: '一等奖 现金999',    prob: 2,  quota: 3,    won: 0 },
  { id: 2, name: '二等奖 AirPods4',   prob: 4,  quota: 5,    won: 0 },
  { id: 3, name: '三等奖 盲盒',       prob: 8,  quota: 50,   won: 0 },
  { id: 4, name: '四等奖 香水',       prob: 15, quota: null, won: 0 },
  { id: 5, name: '五等奖 半价衣服',   prob: 30, quota: null, won: 0 },
  { id: 6, name: '六等奖 优惠券10元', prob: 40, quota: null, won: 0 },
];

// ─────────────────────────────────────────────
// 数据库初始化
// ─────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    code        TEXT PRIMARY KEY,
    platform    TEXT DEFAULT '',
    shop        TEXT DEFAULT '',
    order_time  TEXT DEFAULT '',
    used        INTEGER DEFAULT 0,
    prize       TEXT DEFAULT '',
    draw_time   TEXT DEFAULT '',
    secret      TEXT DEFAULT '',
    redeemed    INTEGER DEFAULT 0,
    redeem_time TEXT DEFAULT '',
    operator    TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─────────────────────────────────────────────
// 数据库工具函数
// ─────────────────────────────────────────────
function cfgGet(key, fallback = null) {
  const row = db.prepare('SELECT value FROM config WHERE key=?').get(key);
  return row ? row.value : fallback;
}
function cfgSet(key, value) {
  db.prepare('INSERT OR REPLACE INTO config(key,value) VALUES(?,?)').run(key, String(value));
}
function cfgGetJSON(key, fallback = null) {
  const v = cfgGet(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

// ─────────────────────────────────────────────
// 快麦签名
// ─────────────────────────────────────────────
function kuaimaiSign(params, secret) {
  const keys = Object.keys(params)
    .filter(k => k !== 'sign' && params[k] !== null && params[k] !== undefined && params[k] !== '')
    .sort();
  let base = '';
  for (const k of keys) base += k + params[k];
  return crypto.createHmac('sha256', secret).update(base).digest('hex').toUpperCase();
}

function nowStamp() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}

// ─────────────────────────────────────────────
// 抽奖逻辑
// ─────────────────────────────────────────────
function doDraw(prizes) {
  const total = prizes.reduce((s, p) => s + (p.prob || 0), 0);
  let r = Math.random() * total;
  for (let i = 0; i < prizes.length; i++) {
    r -= prizes[i].prob || 0;
    if (r <= 0) {
      // 检查名额
      if (prizes[i].quota !== null && prizes[i].won >= prizes[i].quota) {
        // 名额耗尽，顺延到下一个有名额的
        for (let j = i + 1; j < prizes.length; j++) {
          if (prizes[j].quota === null || prizes[j].won < prizes[j].quota) return j;
        }
        return prizes.length - 1; // fallback 最后一档
      }
      return i;
    }
  }
  return prizes.length - 1;
}

function genSecret() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─────────────────────────────────────────────
// 快麦同步
// ─────────────────────────────────────────────
async function fetchKuaimaiWindow(startTime, endTime) {
  const PAGE_SIZE = 200, MAX_PAGES = 50;
  let pageNo = 1, fetched = 0, added = 0, dup = 0, skipped = 0, hasNext = true, error = '';

  const insertOrder = db.prepare(`
    INSERT OR IGNORE INTO orders(code, platform, shop, order_time)
    VALUES(@code, @platform, @shop, @order_time)
  `);

  while (hasNext && pageNo <= MAX_PAGES) {
    const params = {
      method: 'erp.trade.list.query', appKey: KM_APPKEY, session: KM_SESSION,
      timestamp: nowStamp(), format: 'json', version: '1.0', sign_method: 'hmac-sha256',
      timeType: 'upd_time', startTime, endTime,
      pageNo, pageSize: PAGE_SIZE, useHasNext: 'true'
    };
    params.sign = kuaimaiSign(params, KM_SECRET);
    const form = new URLSearchParams();
    for (const k of Object.keys(params)) form.append(k, params[k]);

    let data;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(KM_GATEWAY, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: form.toString(), signal: ctrl.signal
      });
      clearTimeout(timer);
      data = await resp.json();
    } catch (e) {
      error = '网络异常:' + e.message;
      break;
    }
    if (data && data.success === false) {
      error = '快麦错误 code=' + (data.code || '') + ' msg=' + (data.msg || '');
      break;
    }
    const list = (data && data.list) || [];
    fetched += list.length;
    for (const t of list) {
      const tid = t && t.tid ? String(t.tid).trim() : '';
      if (!tid) continue;
      const payMs = t.payTime ? Number(t.payTime) : 0;
      if (!payMs || payMs < EVENT_START_MS || payMs > EVENT_END_MS) { skipped++; continue; }
      const orderTime = new Date(payMs + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
      const r = insertOrder.run({ code: tid, platform: String(t.source || ''), shop: String(t.userId || ''), order_time: orderTime });
      if (r.changes > 0) added++; else dup++;
    }
    hasNext = !!(data && data.hasNext);
    pageNo++;
  }
  return { fetched, added, dup, skipped, error };
}

async function runSync() {
  if (!KM_APPKEY || !KM_SECRET || !KM_SESSION) return { ok: false, msg: '未配置快麦凭证' };
  let cursor = cfgGet('sync:cursor');
  const nowMs = Date.now();
  const startMs = cursor ? Date.parse(cursor.replace(' ', 'T') + '+08:00') : EVENT_START_MS;
  const endMs = Math.min(nowMs, EVENT_END_MS);
  if (startMs >= endMs) return { ok: true, msg: '已是最新', fetched: 0, added: 0 };

  const fmt = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  // 每次最多同步一天（快麦限制）
  const segEnd = Math.min(startMs + 24 * 3600000, endMs);
  const result = await fetchKuaimaiWindow(fmt(startMs), fmt(segEnd));
  const status = {
    ok: !result.error,
    time: nowStamp(),
    msg: result.error || '',
    window: fmt(startMs) + ' ~ ' + fmt(segEnd),
    fetched: result.fetched,
    added: result.added,
    dup: result.dup,
    bad: result.skipped,   // 前端用 s.bad 显示跳过数
  };
  if (!result.error) {
    cfgSet('sync:cursor', fmt(segEnd - 2 * 60000));
    cfgSet('sync:lastStatus', JSON.stringify(status));
  }
  return { ...status, reachedNow: segEnd >= endMs };
}

// ─────────────────────────────────────────────
// HTTP 路由
// ─────────────────────────────────────────────
function sendJSON(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' });
    return res.end();
  }

  // 静态文件：/ 或 /index.html
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const htmlPath = path.join(__dirname, 'index.html');
    if (!fs.existsSync(htmlPath)) { res.writeHead(404); return res.end('index.html not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(htmlPath).pipe(res);
  }

  // ── /api/draw ──────────────────────────────
  if (pathname === '/api/draw' && req.method === 'POST') {
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return sendJSON(res, { ok: false, msg: '请输入订单号' });
    if (Date.now() > EVENT_END_MS) return sendJSON(res, { ok: false, msg: '活动已于 2026年12月31日 结束，感谢参与！' });

    const order = db.prepare('SELECT * FROM orders WHERE code=?').get(code);
    if (!order) return sendJSON(res, { ok: false, msg: '该订单号不存在，无法参与' });
    if (order.used) {
      // 已抽过，返回中奖记录
      return sendJSON(res, { ok: true, already: true, prize: order.prize, drawTime: order.draw_time, secret: order.secret, redeemed: !!order.redeemed, redeemTime: order.redeem_time || "" });
    }

    // 执行抽奖
    let prizes = cfgGetJSON('config:prizes', null);
    if (!prizes) prizes = JSON.parse(JSON.stringify(DEFAULT_PRIZES));
    // 更新 won 计数
    const wonCounts = {};
    const wonRows = db.prepare("SELECT prize, COUNT(*) as cnt FROM orders WHERE used=1 GROUP BY prize").all();
    for (const r of wonRows) wonCounts[r.prize] = r.cnt;
    for (const p of prizes) p.won = wonCounts[p.name] || 0;

    const idx = doDraw(prizes);
    const prize = prizes[idx];
    const secret = genSecret();
    const drawTime = nowStamp();

    db.prepare('UPDATE orders SET used=1, prize=?, draw_time=?, secret=? WHERE code=?')
      .run(prize.name, drawTime, secret, code);

    return sendJSON(res, { ok: true, prize: prize.name, drawTime, secret, code });
  }

  // ── /api/config ────────────────────────────
  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      let prizes = cfgGetJSON('config:prizes', null);
      if (!prizes) prizes = JSON.parse(JSON.stringify(DEFAULT_PRIZES));
      // 补充 won 计数
      const wonRows = db.prepare("SELECT prize, COUNT(*) as cnt FROM orders WHERE used=1 GROUP BY prize").all();
      const wonMap = {};
      for (const r of wonRows) wonMap[r.prize] = r.cnt;
      for (const p of prizes) p.won = wonMap[p.name] || 0;
      return sendJSON(res, { ok: true, prizes });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const pw = String(body.pw || '');
      const savedPw = cfgGet('config:managepw', DEFAULT_MANAGE_PW);
      if (pw !== savedPw && pw !== DEFAULT_MANAGE_PW) return sendJSON(res, { ok: false, msg: '密码错误' });
      if (body.prizes) {
        cfgSet('config:prizes', JSON.stringify(body.prizes));
        return sendJSON(res, { ok: true });
      }
      return sendJSON(res, { ok: false, msg: '无效请求' });
    }
  }

  // ── /api/import ────────────────────────────
  if (pathname === '/api/import' && req.method === 'POST') {
    const body = await readBody(req);
    const pw = String(body.pw || '');
    const savedPw = cfgGet('config:managepw', DEFAULT_MANAGE_PW);
    if (pw !== savedPw && pw !== DEFAULT_MANAGE_PW) return sendJSON(res, { ok: false, msg: '密码错误' });

    const list = body.orders || [];
    const insert = db.prepare(`INSERT OR IGNORE INTO orders(code, platform, shop, order_time) VALUES(@code,@platform,@shop,@order_time)`);
    let added = 0, dup = 0, bad = 0, skipped = 0;

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        const code = String(item.code || '').trim().toUpperCase();
        if (!code) { bad++; continue; }
        // 时间过滤
        if (item.orderTime) {
          const ms = Date.parse(String(item.orderTime).replace(' ', 'T') + '+08:00');
          if (ms && (ms < EVENT_START_MS || ms > EVENT_END_MS)) { skipped++; continue; }
        }
        const r = insert.run({ code, platform: item.platform || '', shop: item.shop || '', order_time: item.orderTime || '' });
        if (r.changes > 0) added++; else dup++;
      }
    });
    insertMany(list);
    return sendJSON(res, { ok: true, added, dup, bad, skipped });
  }

  // ── /api/sync ──────────────────────────────
  if (pathname === '/api/sync') {
    // 查询同步状态
    if (req.method === 'GET' && url.searchParams.get('status') === '1') {
      const s = cfgGetJSON('sync:lastStatus', null);
      return sendJSON(res, { ok: true, status: s });
    }
    // 触发同步
    const key = req.method === 'GET' ? url.searchParams.get('key') : (await readBody(req)).key;
    const savedKey = cfgGet('config:cronkey', 'changeme-cron-2026');
    if (key !== savedKey && key !== 'changeme-cron-2026') return sendJSON(res, { ok: false, msg: 'key 错误' }, 403);
    const result = await runSync();
    return sendJSON(res, result);
  }

  // ── /api/query ─────────────────────────────
  if (pathname === '/api/query' && req.method === 'GET') {
    const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
    if (!code) return sendJSON(res, { ok: false, msg: '请输入订单号' });
    const order = db.prepare('SELECT * FROM orders WHERE code=?').get(code);
    if (!order) return sendJSON(res, { ok: false, msg: '订单号不存在' });
    if (!order.used) return sendJSON(res, { ok: true, used: false });
    return sendJSON(res, { ok: true, used: true, prize: order.prize, drawTime: order.draw_time, secret: order.secret, redeemed: !!order.redeemed, redeemTime: order.redeem_time || "" });
  }

  // ── /api/winners ───────────────────────────
  if (pathname === '/api/winners' && req.method === 'POST') {
    const body = await readBody(req);
    const pw = String(body.pw || '');
    const savedPw = cfgGet('config:managepw', DEFAULT_MANAGE_PW);
    if (pw !== savedPw && pw !== DEFAULT_MANAGE_PW) return sendJSON(res, { ok: false, msg: '密码错误' });
    const rows = db.prepare('SELECT code, prize, draw_time, secret, redeemed, redeem_time, operator, platform, shop, order_time FROM orders WHERE used=1 ORDER BY draw_time DESC').all();
    return sendJSON(res, { ok: true, winners: rows });
  }

  // ── /api/redeem ────────────────────────────
  if (pathname === '/api/redeem' && req.method === 'POST') {
    const body = await readBody(req);
    const pw = String(body.pw || '');
    const savedPw = cfgGet('config:adminpw', DEFAULT_REDEEM_PW);
    if (pw !== savedPw && pw !== DEFAULT_REDEEM_PW) return sendJSON(res, { ok: false, msg: '客服密码错误' });

    const code = String(body.code || '').trim().toUpperCase();
    const secret = String(body.secret || '').trim().toUpperCase();
    const operator = String(body.operator || '').trim();
    const order = db.prepare('SELECT * FROM orders WHERE code=?').get(code);
    if (!order || !order.used) return sendJSON(res, { ok: false, msg: '凭证无效' });
    if (order.secret !== secret) return sendJSON(res, { ok: false, msg: '防伪码不符' });
    if (order.redeemed) return sendJSON(res, { ok: false, msg: '此凭证已核销过', redeemTime: order.redeem_time, operator: order.operator });
    db.prepare('UPDATE orders SET redeemed=1, redeem_time=?, operator=? WHERE code=?').run(nowStamp(), operator, code);
    return sendJSON(res, { ok: true, prize: order.prize, code });
  }

  // ── /api/changepw ──────────────────────────
  if (pathname === '/api/changepw' && req.method === 'POST') {
    const body = await readBody(req);
    const pw = String(body.pw || '');
    const type = String(body.type || '');
    const newpw = String(body.newpw || '').trim();
    if (!newpw || newpw.length < 4) return sendJSON(res, { ok: false, msg: '新密码至少4位' });
    const savedManagePw = cfgGet('config:managepw', DEFAULT_MANAGE_PW);
    if (pw !== savedManagePw && pw !== DEFAULT_MANAGE_PW) return sendJSON(res, { ok: false, msg: '当前密码错误' });
    if (type === 'manage') { cfgSet('config:managepw', newpw); return sendJSON(res, { ok: true }); }
    if (type === 'redeem') { cfgSet('config:adminpw', newpw); return sendJSON(res, { ok: true }); }
    return sendJSON(res, { ok: false, msg: '类型错误' });
  }

  // 404
  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`S123 抽奖系统已启动：http://localhost:${PORT}`);
  console.log(`数据库：${DB_PATH}`);
  if (!KM_SECRET || !KM_SESSION) console.warn('⚠ 未配置快麦凭证（KM_SECRET / KM_SESSION），快麦同步不可用');
});
