/* public/app.js v3 — 完整交互版（连接/断开、日志清空/复制/下载/暂停、级别过滤） */
(function () {
  "use strict";

  // ---------- DOM 获取 ----------
  const $  = s => document.querySelector(s);
  const rawDot   = $('#rawDot'),   rawText   = $('#rawText');
  const pubDot   = $('#pubDot'),   pubText   = $('#pubText');
  const logsEl   = $('#logs');
  const btnRawClose   = $('#btnRawClose');
  const btnPubClose   = $('#btnPubClose');
  const btnBeat       = $('#btnPublishBeat');
  const btnSnap       = $('#btnPublishSnap');
  const btnLogPause   = $('#btnLogPause');
  const btnLogClear   = $('#btnLogClear');
  const btnLogCopy    = $('#btnLogCopy');
  const btnLogDL      = $('#btnLogDownload');
  const selLogLevel   = $('#logLevel');
  const btnToggleMock = $('#btnToggleMock');
  const mockBadge     = $('#mockBadge');

  // ---------- 状态 ----------
  let srcWS = null;
  let pubWS = null;
  let logPaused = false;
  let logBuffer = []; // 用于复制/下载
  let logMinLevel = 'ALL'; // ALL/INFO/WARN/ERROR/DEBUG
  let isMock = false;

  // ---------- 工具 ----------
  const LEVEL_ORDER = { 'ALL':0, 'DEBUG':1, 'INFO':2, 'WARN':3, 'ERROR':4 };
  function allowLevel(level) {
    // 选了 INFO，就不显示 DEBUG；选 ALL 则都显示
    if (!LEVEL_ORDER[level] || !LEVEL_ORDER[logMinLevel]) return true;
    if (logMinLevel === 'ALL') return true;
    return LEVEL_ORDER[level] >= LEVEL_ORDER[logMinLevel];
  }
  function ts() {
    return new Date().toTimeString().slice(0,8);
  }
  function setDot(el, ok) {
    if (!el) return;
    el.classList.remove('gray', 'green', 'red');
    el.classList.add(ok ? 'green' : 'red');
  }
  function setRawStatus(ok, text) {
    if (rawText) rawText.textContent = text || (ok ? '已连接' : '未连接');
    setDot(rawDot, ok);
  }
  function setPubStatus(ok, text) {
    if (pubText) pubText.textContent = text || (ok ? '已连接' : '未连接');
    setDot(pubDot, ok);
  }
  function log(level, msg) {
    const line = `[${ts()}][${level}] ${msg}`;
    logBuffer.push(line);
    if (!logsEl) return;
    if (!allowLevel(level)) return;
    logsEl.textContent += line + '\n';
    if (!logPaused) {
      logsEl.scrollTop = logsEl.scrollHeight;
    }
  }
  function safeClose(ws) { try { ws?.close?.(); } catch(e){} }

  // ---------- 连接函数（供 index.html 调用） ----------
  window.connectSource = function (url) {
    safeClose(srcWS);
    log('INFO', `src 打开 ${url}`);
    try {
      srcWS = new WebSocket(url);
    } catch (e) {
      log('ERROR', `src open fail: ${e.message||e}`);
      setRawStatus(false, '未连接');
      return;
    }
    srcWS.onopen = () => { setRawStatus(true,'已连接'); log('INFO','src open'); };
    srcWS.onclose= () => { setRawStatus(false,'未连接'); log('WARN','src close'); };
    srcWS.onerror= () => { setRawStatus(false); log('ERROR','src error'); };
    srcWS.onmessage = (ev) => {
      const s = typeof ev.data === 'string' ? ev.data : '[binary]';
      log('DEBUG', `src msg len=${s.length}`);
      // TODO: 这里可以把原始数据灌到“上表”
    };
  };

  window.connectPublisher = function (url) {
    safeClose(pubWS);
    log('INFO', `pub 打开 ${url}`);
    try {
      pubWS = new WebSocket(url);
    } catch (e) {
      log('ERROR', `pub open fail: ${e.message||e}`);
      setPubStatus(false, '未连接');
      return;
    }
    pubWS.onopen = () => { setPubStatus(true,'已连接'); log('INFO','pub open'); };
    pubWS.onclose= () => { setPubStatus(false,'未连接'); log('WARN','pub close'); };
    pubWS.onerror= () => { setPubStatus(false); log('ERROR','pub error'); };
    pubWS.onmessage = (ev) => {
      const s = typeof ev.data === 'string' ? ev.data : '[binary]';
      // A 端连到这里时可收到内容；F 端主要是发送
      log('DEBUG', `pub msg len=${s.length}`);
    };
  };

  // 也暴露“断开”给外部（目前用不上，但保留）
  window.disconnectSource   = function() { safeClose(srcWS); };
  window.disconnectPublisher= function() { safeClose(pubWS); };

  // ---------- 按钮：断开 ----------
  btnRawClose?.addEventListener('click', () => {
    if (!srcWS || srcWS.readyState !== 1) { log('WARN','src 未连接'); return; }
    safeClose(srcWS);
  });
  btnPubClose?.addEventListener('click', () => {
    if (!pubWS || pubWS.readyState !== 1) { log('WARN','pub 未连接'); return; }
    safeClose(pubWS);
  });

  // ---------- 按钮：心跳 / Snapshot ----------
  btnBeat?.addEventListener('click', () => {
    if (pubWS?.readyState === 1) {
      pubWS.send(JSON.stringify({ type:'heartbeat', ts: Date.now() }));
      log('INFO', 'pub 发送 heartbeat');
    } else {
      log('WARN', 'pub 未连接');
    }
  });
  btnSnap?.addEventListener('click', () => {
    if (pubWS?.readyState === 1) {
      const snap = { type:'snapshot', data: [] }; // TODO: 把“下表”数据填入 data
      pubWS.send(JSON.stringify(snap));
      log('INFO', 'pub 发送 snapshot');
    } else {
      log('WARN', 'pub 未连接');
    }
  });

  // ---------- 日志：暂停/清空/复制/下载/级别 ----------
  btnLogPause?.addEventListener('click', () => {
    logPaused = !logPaused;
    btnLogPause.textContent = logPaused ? '恢复滚动' : '暂停滚动';
  });
  btnLogClear?.addEventListener('click', () => {
    logBuffer = [];
    if (logsEl) logsEl.textContent = '';
  });
  btnLogCopy?.addEventListener('click', async () => {
    const text = logBuffer.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      log('INFO','已复制日志到剪贴板');
    } catch (e) {
      log('ERROR', '复制失败：' + (e.message||e));
    }
  });
  btnLogDL?.addEventListener('click', () => {
    const text = logBuffer.join('\n');
    const blob = new Blob([text], {type:'text/plain'});
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feed-logs-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  selLogLevel?.addEventListener('change', () => {
    logMinLevel = selLogLevel.value || 'ALL';
    // 重新渲染可见区（简单做法：清空重刷）
    if (logsEl) {
      logsEl.textContent = '';
      for (const line of logBuffer) {
        // 粗略解析级别
        const m = line.match(/\]\[(ALL|DEBUG|INFO|WARN|ERROR)\]\s/);
        const lv = m ? m[1] : 'INFO';
        if (allowLevel(lv)) logsEl.textContent += line + '\n';
      }
      if (!logPaused) logsEl.scrollTop = logsEl.scrollHeight;
    }
  });

  // ---------- Mock 开关（可扩展为离线演示） ----------
  btnToggleMock?.addEventListener('click', () => {
    isMock = !isMock;
    if (mockBadge) mockBadge.textContent = `Mock: ${isMock ? 'ON' : 'OFF'}`;
    log('INFO', `Mock ${isMock?'开启':'关闭'}`);
    // TODO: 开启时可向“上表”灌入演示数据
  });

  // ---------- 初始化 ----------
  if (rawDot) rawDot.classList.add('gray');
  if (pubDot) pubDot.classList.add('gray');
  if (btnLogPause) btnLogPause.textContent = '暂停滚动';
  if (selLogLevel) logMinLevel = selLogLevel.value || 'ALL';
  log('INFO', `build=${window.__BUILD_SHA__ || 'dev'}`);
})();
