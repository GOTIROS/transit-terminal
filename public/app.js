/* transit-terminal /public/app.js
 * 目标：
 * 1) 发布端点不再强制需要 PUBLISH_TOKEN；
 * 2) 原始/发布 WSS URL 自动保存到 localStorage，刷新后自动恢复；
 * 3) 现有 UI（按钮文字：连接原始流 / 连接发布端点 / 发布 Snapshot / 发送 Heartbeat）可直接挂载；
 * 4) 兼容你当前 index.html，无需改动 HTML。
 */

(() => {
  // ---------- 工具 & 日志 ----------
  const LSK = {
    SRC_URL: 'tt_src_wss_url',
    PUB_URL: 'tt_pub_wss_url',
    PUB_TOKEN: 'tt_pub_token_opt' // 仍可选；不填就不附带
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function pickButtonByText(text) {
    return $$('button').find(b => (b.textContent || '').trim().includes(text));
  }

  function pickInputNear(btn, nth = 0) {
    // 找到按钮同卡片区域内第 nth 个文本输入（用于“原始 WSS URL / 发布 WSS URL”）
    if (!btn) return null;
    // 向上找块容器
    let box = btn.closest('section,div,article') || document.body;
    const inputs = $$('input[type="text"], input[type="search"]', box);
    return inputs[nth] || null;
  }

  // 右下角日志面板（如果你已有，就同时输出到你已有的日志框/控制台）
  const LOG = {
    line(type, obj) {
      const ts = new Date().toLocaleTimeString();
      const txt = `[${ts}] [${type}] ${typeof obj === 'string' ? obj : JSON.stringify(obj)}`;
      console[type === 'ERROR' ? 'error' : type === 'WARN' ? 'warn' : 'log'](txt);
      const logBox = $('#logBox') || null; // 若你页面已有 id=logBox 的日志区域会显示
      if (logBox) {
        const p = document.createElement('div');
        p.textContent = txt;
        logBox.appendChild(p);
        logBox.scrollTop = logBox.scrollHeight;
      }
    },
    info(x){ this.line('INFO', x); },
    warn(x){ this.line('WARN', x); },
    error(x){ this.line('ERROR', x); },
    debug(x){ this.line('DEBUG', x); },
  };

  // ---------- 恢复 & 保存 输入框 ----------
  function bindRemember(input, key) {
    if (!input) return;
    // 恢复
    const v = localStorage.getItem(key);
    if (v) input.value = v;
    // 监听保存
    ['change','blur','input'].forEach(ev => {
      input.addEventListener(ev, () => localStorage.setItem(key, input.value.trim()));
    });
  }

  // ---------- WebSocket 逻辑 ----------
  let srcWS = null;
  let pubWS = null;
  let pubHeartbeatTimer = null;

  function closeWS(ws, tag) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.close(1000, 'manual close'); } catch {}
    }
    LOG.info(`${tag} closed`);
  }

  function connectSource(url) {
    if (!url) { alert('请填写 原始 WSS URL'); return; }
    try { closeWS(srcWS, 'src'); } catch {}
    LOG.info(`src 打开 {"url":"${url}"}`);

    srcWS = new WebSocket(url);
    srcWS.onopen = () => LOG.info('src 已连接');
    srcWS.onmessage = (ev) => {
      // 这里保留原样：你如果有“上表：原始数据”的渲染逻辑，继续沿用你现有的处理
      LOG.debug({ src_msg: safeParse(ev.data) });
    };
    srcWS.onerror = (e) => LOG.warn('src error');
    srcWS.onclose = () => LOG.warn('src 断开');
  }

  function connectPublish(url, tokenOpt) {
    if (!url) { alert('请填写 发布 WSS URL'); return; }

    // ✅ 不再强制 token。若填写 token 则附带，否则不附带。
    try { closeWS(pubWS, 'pub'); } catch {}
    // 拼 URL（只有 token 存在才拼）
    let finalUrl = url;
    try {
      const u = new URL(url);
      const t = (tokenOpt || '').trim();
      if (t) u.searchParams.set('token', t);
      finalUrl = u.toString();
    } catch(e) {
      // 有些人会只填 //host/path
    }

    LOG.info(`pub 打开 {"url":"${finalUrl}"}`);
    pubWS = new WebSocket(finalUrl);
    pubWS.onopen = () => {
      LOG.info('pub 已连接');
      // Heartbeat 定时器（如果你点了“发送 Heartbeat”按钮则手动发，这里也可以自动发）
      if (pubHeartbeatTimer) clearInterval(pubHeartbeatTimer);
      pubHeartbeatTimer = setInterval(() => {
        trySend(pubWS, { type:'heartbeat', ts: Date.now() }, 'pub 心跳');
      }, 30_000);
    };
    pubWS.onmessage = (ev) => LOG.debug({ pub_msg: safeParse(ev.data) });
    pubWS.onerror = () => LOG.warn('pub error');
    pubWS.onclose = () => {
      LOG.warn('pub 断开');
      if (pubHeartbeatTimer) clearInterval(pubHeartbeatTimer);
      pubHeartbeatTimer = null;
    };
  }

  function trySend(ws, obj, tag='send') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      LOG.warn(`${tag} 失败：未连接`);
      return false;
    }
    try {
      ws.send(JSON.stringify(obj));
      LOG.info(`${tag} 已发送`);
      return true;
    } catch(e) {
      LOG.error(`${tag} 发送异常`);
      return false;
    }
  }

  function safeParse(x){
    try { return JSON.parse(x); } catch { return x; }
  }

  // ---------- 发布面板动作（Snapshot / Heartbeat） ----------
  function collectPublishRows() {
    // 按你页面原逻辑收集“下表：发布表”数据。
    // 这里留一个尽量“宽容”的示例：
    const tbl = $('#pubTable') || $('table[data-pub]') || null;
    const rows = [];
    if (!tbl) return rows;

    const trs = $$('tbody tr', tbl);
    trs.forEach(tr => {
      const tds = $$('td', tr).map(td => (td.textContent || '').trim());
      if (tds.length) {
        rows.push({ raw: tds });
      }
    });
    return rows;
  }

  function doPublishSnapshot() {
    if (!pubWS || pubWS.readyState !== WebSocket.OPEN) {
      alert('发布端尚未连接'); return;
    }
    const rows = collectPublishRows();
    const payload = {
      type: 'snapshot',
      ts: Date.now(),
      // 你可以替换为真正的“发布表结构”
      data: rows
    };
    trySend(pubWS, payload, '发布 Snapshot');
  }

  function doSendHeartbeat() {
    trySend(pubWS, { type:'heartbeat', ts: Date.now() }, 'Heartbeat');
  }

  // ---------- 绑定 UI ----------
  function initUI() {
    // 1) “连接原始流”区域
    const btnSrc = pickButtonByText('连接原始流');
    const srcInput = pickInputNear(btnSrc, 0);
    bindRemember(srcInput, LSK.SRC_URL);

    if (btnSrc) {
      btnSrc.addEventListener('click', () => {
        const url = (srcInput && srcInput.value.trim()) || '';
        connectSource(url);
      });
    }

    // 2) “连接发布端点”区域（不再强制 token）
    const btnPub = pickButtonByText('连接发布端点');
    const pubInput = pickInputNear(btnPub, 0);         // 发布 WSS URL
    const tokenInput = null;                            // 你页面已取消强制，若仍保留输入框，可自行定位后放开这里
    bindRemember(pubInput, LSK.PUB_URL);
    // 如果你仍保留一个“token 输入框”，放开下面两行并确保 token 输入能被找到
    // const tokenInput = pickInputNear(btnPub, 1);
    // bindRemember(tokenInput, LSK.PUB_TOKEN);

    if (btnPub) {
      btnPub.addEventListener('click', () => {
        const url = (pubInput && pubInput.value.trim()) || '';
        const token = tokenInput ? (tokenInput.value || '').trim() : (localStorage.getItem(LSK.PUB_TOKEN) || '').trim();
        connectPublish(url, token || ''); // ✅ 允许空 token
      });
    }

    // 3) “发布 Snapshot（全量）”
    const btnSnap = pickButtonByText('发布 Snapshot');
    if (btnSnap) btnSnap.addEventListener('click', doPublishSnapshot);

    // 4) “发送 Heartbeat”
    const btnHb = pickButtonByText('发送 Heartbeat');
    if (btnHb) btnHb.addEventListener('click', doSendHeartbeat);

    // 5) 去掉旧版“必须填写 token”的提示（如有老逻辑弹窗）
    // 只要能找到发布 URL，就认为表单是可用的
    const oldGuardAlert = window.__NEED_TOKEN_ALERT__;
    if (oldGuardAlert && typeof oldGuardAlert === 'function') {
      window.__NEED_TOKEN_ALERT__ = () => {}; // 覆盖为 no-op
    }

    LOG.info('UI 初始化完成');
  }

  // ---------- 启动 ----------
  document.addEventListener('DOMContentLoaded', initUI);
})();
