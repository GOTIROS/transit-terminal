/* public/app.js — F 端中转与发布（全 WSS） */

// ---------- DOM helpers ----------
const $ = id => document.getElementById(id);
const on = (el, ev, fn) => el.addEventListener(ev, fn);

// ---------- 日志 ----------
const logsEl = $("logs");
let LOG_BUF = [];
let LOG_PAUSED = false;

function log(level, ...args) {
  const ts = new Date().toTimeString().slice(0,8);
  const line = `[${ts}][${level}] ${args.map(v=>(
    typeof v === 'string' ? v : JSON.stringify(v)
  )).join(' ')}`;
  LOG_BUF.push(line);
  if (LOG_BUF.length > 2000) LOG_BUF.shift();
  if (!LOG_PAUSED) {
    logsEl.textContent += (logsEl.textContent ? '\n' : '') + line;
    logsEl.scrollTop = logsEl.scrollHeight;
  }
}
function logClear() {
  LOG_BUF = [];
  logsEl.textContent = '';
}
function logFlushAll() {
  logsEl.textContent = LOG_BUF.join('\n');
  logsEl.scrollTop = logsEl.scrollHeight;
}

// ---------- 状态灯 ----------
function setDot(kind, color, text) {
  const dot = kind === 'raw' ? $('rawDot') : $('pubDot');
  const tx  = kind === 'raw' ? $('rawText') : $('pubText');
  dot.className = `dot ${color}`;
  tx.textContent = text;
}

// ---------- LS (地址记忆) ----------
const LS_KEYS = {
  RAW_URL: 'f_raw_url',
  RAW_TOKEN: 'f_raw_token',
  PUB_URL: 'f_pub_url',
  PUB_TOKEN: 'f_pub_token',
};
function saveInputs() {
  localStorage.setItem(LS_KEYS.RAW_URL,  $('rawUrl').value.trim());
  localStorage.setItem(LS_KEYS.RAW_TOKEN,$('rawToken').value.trim());
  localStorage.setItem(LS_KEYS.PUB_URL,  $('pubUrl').value.trim());
  localStorage.setItem(LS_KEYS.PUB_TOKEN,$('pubToken').value.trim());
}
function restoreInputs() {
  $('rawUrl').value   = localStorage.getItem(LS_KEYS.RAW_URL)   || '';
  $('rawToken').value = localStorage.getItem(LS_KEYS.RAW_TOKEN) || '';
  $('pubUrl').value   = localStorage.getItem(LS_KEYS.PUB_URL)   || 'wss://feed.youdatan.com/ws';
  $('pubToken').value = localStorage.getItem(LS_KEYS.PUB_TOKEN) || '';
}

// ---------- 数据区（上表/下表） ----------
let RAW_ROWS = [];        // 原始区所有行
let PUB_ROWS = [];        // 下表候选区所有行
let ACTIVE_TAB = 'all';   // 上表 tab：all/isp/pm

const RAW_THEAD = [
  'event_id','source','league','home','away','period',
  'market','line_text','pickA','pickB'
];
function renderRawTable() {
  const thead = $('rawTable').querySelector('thead');
  const tbody = $('rawTable').querySelector('tbody');
  thead.innerHTML = `<tr>${RAW_THEAD.map(h=>`<th>${h}</th>`).join('')}</tr>`;
  const rows = RAW_ROWS.filter(r => ACTIVE_TAB==='all' ? true : r.source===ACTIVE_TAB);
  $('rawCount').textContent = String(rows.length);
  tbody.innerHTML = rows.map(r=>{
    const pickA = JSON.stringify(r.pickA);
    const pickB = JSON.stringify(r.pickB);
    return `<tr>
      <td>${r.event_id}</td><td>${r.source}</td><td>${r.league}</td>
      <td>${r.home}</td><td>${r.away}</td><td>${r.period}</td>
      <td>${r.market}</td><td>${r.line_text}</td>
      <td>${pickA}</td><td>${pickB}</td>
    </tr>`;
  }).join('');
}

const PUB_THEAD = RAW_THEAD;
function renderPubTable() {
  const thead = $('pubTable').querySelector('thead');
  const tbody = $('pubTable').querySelector('tbody');
  thead.innerHTML = `<tr>${PUB_THEAD.map(h=>`<th>${h}</th>`).join('')}</tr>`;

  // 过滤
  const fs = $('f_source').value;
  const fm = $('f_market').value;
  const fp = $('f_period').value;
  const rows = PUB_ROWS.filter(r=>{
    if (fs && r.source !== fs) return false;
    if (fm && r.market !== fm) return false;
    if (fp && r.period !== fp) return false;
    return true;
  });

  tbody.innerHTML = rows.map(r=>{
    const pickA = JSON.stringify(r.pickA);
    const pickB = JSON.stringify(r.pickB);
    return `<tr>
      <td>${r.event_id}</td><td>${r.source}</td><td>${r.league}</td>
      <td>${r.home}</td><td>${r.away}</td><td>${r.period}</td>
      <td>${r.market}</td><td>${r.line_text}</td>
      <td>${pickA}</td><td>${pickB}</td>
    </tr>`;
  }).join('');
}

// ---------- WebSocket：原始(Server→F) & 发布(F→/ws) ----------
let wsRaw = null;
let wsPub = null;
let pubHeartTimer = null;
let pubBackoffTimer = null;

function safeCloseWS(ws, reason='user close') {
  try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; } catch {}
  try { ws.close(1000, reason); } catch {}
}

function connectRaw() {
  if (wsRaw && wsRaw.readyState === 1) return;
  const url = $('rawUrl').value.trim();
  if (!url) { alert('请填写 原始 WSS URL'); return; }
  saveInputs();

  try { wsRaw && safeCloseWS(wsRaw); } catch {}
  wsRaw = new WebSocket(url);
  wsRaw.addEventListener('open', ()=>{
    setDot('raw','green','已连接');
    log('INFO','raw open',url);
  });
  wsRaw.addEventListener('message', (ev)=>{
    // 期望收到的是 snapshot/opportunity/heartbeat 等；这里只把 snapshot 的 data 灌入上表
    try {
      const msg = JSON.parse(ev.data);
      if (msg && msg.type === 'snapshot' && Array.isArray(msg.data)) {
        RAW_ROWS = msg.data;
        renderRawTable();
        log('DEBUG','raw msg snapshot len=', String(msg.data.length));
      } else {
        log('DEBUG','raw msg', ev.data.slice(0,120));
      }
    } catch(e) {
      log('WARN', 'raw non-json', String(ev.data).slice(0,120));
    }
  });
  wsRaw.addEventListener('error', (e)=>{
    log('ERROR','raw error');
  });
  wsRaw.addEventListener('close', ()=>{
    setDot('raw','red','未连接');
    log('WARN','raw close');
  });
}

function disconnectRaw() {
  if (wsRaw) {
    safeCloseWS(wsRaw);
    wsRaw = null;
  }
  setDot('raw','red','未连接');  // 立刻反馈
  log('INFO','raw manual close');
}

function connectPub() {
  if (wsPub && wsPub.readyState === 1) return;
  const url = $('pubUrl').value.trim();
  if (!url) { alert('请填写 发布 WSS URL'); return; }
  saveInputs();

  // 清理
  if (wsPub) { try { safeCloseWS(wsPub); } catch {} wsPub=null; }
  if (pubHeartTimer) { clearInterval(pubHeartTimer); pubHeartTimer=null; }
  if (pubBackoffTimer){ clearTimeout(pubBackoffTimer); pubBackoffTimer=null; }

  wsPub = new WebSocket(url);
  wsPub.addEventListener('open', ()=>{
    setDot('pub','green','已连接');
    log('INFO','pub open', url);

    // 心跳（给服务端/观看端一个活跃信号）
    pubHeartTimer = setInterval(()=>{
      try {
        wsPub && wsPub.readyState===1 && wsPub.send(JSON.stringify({type:'heartbeat', ts:Date.now()}));
      } catch {}
    }, 3000);
  });
  wsPub.addEventListener('message', (ev)=>{
    log('DEBUG','pub msg len=', String((ev.data||'').length));
  });
  wsPub.addEventListener('error', ()=>{
    log('ERROR','pub error');
  });
  wsPub.addEventListener('close', ()=>{
    if (pubHeartTimer) { clearInterval(pubHeartTimer); pubHeartTimer=null; }
    setDot('pub','red','未连接');
    log('WARN','pub close');
  });
}

function disconnectPub() {
  if (pubBackoffTimer){ clearTimeout(pubBackoffTimer); pubBackoffTimer=null; }
  if (pubHeartTimer)  { clearInterval(pubHeartTimer); pubHeartTimer=null; }
  if (wsPub) { try { safeCloseWS(wsPub); } catch {} wsPub=null; }
  setDot('pub','red','未连接');        // 立刻反馈，不等 server close
  log('INFO','pub manual close');
}

// ---------- 发布动作 ----------
function publishSnapshot(rows) {
  if (!wsPub || wsPub.readyState !== 1) {
    alert('发布端未连接'); return;
  }
  const data = Array.isArray(rows) ? rows : PUB_ROWS;
  try {
    wsPub.send(JSON.stringify({type:'snapshot', data}));
    log('INFO','publish snapshot', 'len='+String(data.length));
  } catch(e) {
    log('ERROR','publish snapshot failed');
  }
}
function publishHeartbeat() {
  if (!wsPub || wsPub.readyState !== 1) {
    alert('发布端未连接'); return;
  }
  try {
    wsPub.send(JSON.stringify({type:'heartbeat', ts: Date.now()}));
    log('INFO','publish heartbeat');
  } catch(e) {
    log('ERROR','publish heartbeat failed');
  }
}

// ---------- Mock 流 ----------
let MOCK_ON = false;
let mockTimer = null;

const MOCK_BASE = [
  {
    event_id: 'E1001', source: 'isp', league: '英超', home:'阿森纳', away:'切尔西',
    period: 'FT', market:'ou', line_text:'2.5',
    pickA: { book:'Singbet', selection:'over',  odds:0.95 },
    pickB: { book:'Parimatch', selection:'under', odds:0.92 }
  },
  {
    event_id: 'E1002', source: 'pm', league: '西甲', home:'巴萨', away:'皇马',
    period: 'HT', market:'ah', line_text:'-0.25',
    pickA: { book:'Parimatch', selection:'home', odds:1.02 },
    pickB: { book:'Singbet',   selection:'away', odds:0.88 }
  }
];

function startMock() {
  if (mockTimer) clearInterval(mockTimer);
  MOCK_ON = true;
  $('mockBadge').textContent = 'Mock: ON';
  setDot('raw','green','已连接');

  // 先发一版快照到“上表”
  RAW_ROWS = JSON.parse(JSON.stringify(MOCK_BASE));
  renderRawTable();
  log('INFO','Mock 开启');

  // 每 3 秒抖动赔率，并自动向发布端发 snapshot（若已连接）
  mockTimer = setInterval(()=>{
    RAW_ROWS.forEach(r=>{
      const jitter = (Math.random()*0.06 - 0.03); // [-0.03,0.03)
      if (r.pickA && typeof r.pickA.odds === 'number') {
        r.pickA.odds = +(Math.max(0.7, r.pickA.odds + jitter)).toFixed(2);
      }
      if (r.pickB && typeof r.pickB.odds === 'number') {
        r.pickB.odds = +(Math.max(0.7, r.pickB.odds - jitter)).toFixed(2);
      }
    });
    renderRawTable();

    // 自动对 A 端发一份 snapshot（便于前端连 F 测试展示）
    if (wsPub && wsPub.readyState===1) {
      publishSnapshot(RAW_ROWS);
    }
  }, 3000);
}

function stopMock() {
  MOCK_ON = false;
  if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }
  $('mockBadge').textContent = 'Mock: OFF';
  setDot('raw','red','未连接');
  log('INFO','Mock 关闭');
}

// ---------- 交互绑定 ----------
function bindUI() {
  // 顶部 build 信息
  $('buildInfo').textContent = (window.__BUILD_SHA__ || 'dev');

  // 输入变更即保存
  ['rawUrl','rawToken','pubUrl','pubToken'].forEach(id=>{
    on($(id),'change', saveInputs);
    on($(id),'blur',   saveInputs);
  });

  // 原始流
  on($('btnRawConnect'),'click', connectRaw);
  on($('btnRawClose'),  'click', disconnectRaw);
  on($('btnToggleMock'),'click', ()=>{
    MOCK_ON ? stopMock() : startMock();
  });

  // 发布
  on($('btnPubConnect'),'click', connectPub);
  on($('btnPubClose'),  'click', disconnectPub);
  on($('btnPublishSnap'),'click', ()=>publishSnapshot());
  on($('btnPublishBeat'),'click', publishHeartbeat);

  // 上表 tabs
  document.querySelectorAll('.tabs .tab').forEach(btn=>{
    on(btn,'click', ()=>{
      document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
      ACTIVE_TAB = btn.dataset.tab || 'all';
      renderRawTable();
    });
  });

  // 上表按钮
  on($('btnAllToPublish'),'click', ()=>{
    const rows = RAW_ROWS.filter(r => ACTIVE_TAB==='all' ? true : r.source===ACTIVE_TAB);
    PUB_ROWS = PUB_ROWS.concat(rows);
    renderPubTable();
    log('INFO','加入下表', 'len='+String(rows.length));
  });
  on($('btnClearRaw'),'click', ()=>{
    RAW_ROWS = [];
    renderRawTable();
    log('INFO','清空原始');
  });

  // 下表筛选
  on($('btnApplyFilter'),'click', renderPubTable);
  on($('btnClearFilter'),'click', ()=>{
    $('f_source').value=''; $('f_market').value=''; $('f_period').value='';
    renderPubTable();
  });
  on($('btnClearPublish'),'click', ()=>{
    PUB_ROWS = [];
    renderPubTable();
    log('INFO','清空下表');
  });
  on($('btnDownloadJson'),'click', ()=>{
    const blob = new Blob([JSON.stringify(PUB_ROWS, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // 日志区
  on($('btnLogPause'),'click', ()=>{
    LOG_PAUSED = !LOG_PAUSED;
    $('btnLogPause').textContent = LOG_PAUSED ? '恢复滚动' : '暂停滚动';
    if (!LOG_PAUSED) logFlushAll();
  });
  on($('btnLogClear'),'click', logClear);
  on($('btnLogCopy'),'click', ()=>{
    navigator.clipboard.writeText(LOG_BUF.join('\n')).then(()=>log('INFO','日志已复制'));
  });
  on($('btnLogDownload'),'click', ()=>{
    const blob = new Blob([LOG_BUF.join('\n')], {type:'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `logs_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- 启动 ----------
(function boot(){
  restoreInputs();
  setDot('raw','gray','未连接');
  setDot('pub','gray','未连接');
  bindUI();
  renderRawTable();
  renderPubTable();
  log('INFO','build='+ (window.__BUILD_SHA__ || 'dev'));
})();
