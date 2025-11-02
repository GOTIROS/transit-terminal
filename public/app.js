/* public/app.js — F端 · 中转与发布
 * 关键点：
 * 1) 发布端连接不再强制要求 token，允许空；同时用 role=publisher 明确身份
 * 2) 若填写 token 仍会附带；未填写则不带
 * 3) 原始流连接（Server→F）、Mock、映射加载、上表/下表、导出、发布 Snapshot/Heartbeat、日志
 * 4) 选择器做了多路回退（id/name），避免因 DOM 命名差异绑不上
 */
"use strict";

/* ========================== Utils ========================== */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function pick(...sels) {
  for (const s of sels) {
    if (!s) continue;
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function jsonParseSafe(txt, fb=null) {
  try { return JSON.parse(typeof txt === 'string' ? txt : String(txt)); } catch { return fb; }
}

function jsonStringSafe(obj) {
  try { return JSON.stringify(obj); } catch { return String(obj); }
}

function nowTS() { return new Date().toISOString().slice(11,19); }

/* ========================== Logger ========================== */
const elLogList = pick('#logList', '#logBody', 'pre[data-log]', '#logPre');
const elLogLevel = pick('#logLevel', 'select[name="logLevel"]');

function addLog(level, msg, extra) {
  if (!elLogList) return;
  const line = `[${nowTS()}][${level}] ${msg}` + (extra ? ' ' + jsonStringSafe(extra) : '');
  if (elLogList.tagName === 'PRE') {
    elLogList.textContent += (elLogList.textContent ? '\n' : '') + line;
  } else {
    const li = document.createElement('div');
    li.textContent = line;
    elLogList.appendChild(li);
    // 滚动到底
    elLogList.scrollTop = elLogList.scrollHeight;
  }
  // 控制台也打一份（便于排查）
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

/* ========================== State ========================== */
const store = {
  // 上表：原始数据
  rawRows: [],
  // 下表：发布表候选
  pubRows: [],
  // 映射（可选）
  maps: {
    id: { leagues: null, teams: null, bookmakers: null },
    en: { leagues: null, teams: null },
  },
  // 连接对象
  wsSrc: null,      // Server -> F
  wsPub: null,      // F -> 发布端（feed.youdatan.com）
};

/* ========================== DOM Refs（多路回退） ========================== */
// 原始流连接（Server -> F）
const elSrcUrl    = pick('#srcUrl',    'input[name="srcUrl"]');
const elSrcToken  = pick('#srcToken',  'input[name="srcToken"]');
const btnSrcConn  = pick('#btnSrcConn','button[data-action="src-connect"]', 'button#srcConnect');
const btnSrcOff   = pick('#btnSrcOff', 'button[data-action="src-off"]');
const btnMockToggle = pick('#btnMock', 'button[data-action="mock-toggle"]');

// 发布连接（F -> feed.youdatan.com）
const elPubUrl    = pick('#pubUrl',    'input[name="pubUrl"]');
const elPubToken  = pick('#pubToken',  'input[name="pubToken"]'); // 可空
const btnPubConn  = pick('#btnPubConn','button[data-action="pub-connect"]', 'button#pubConnect');
const btnPubOff   = pick('#btnPubOff', 'button[data-action="pub-off"]');
const btnSnapshot = pick('#btnSnapshot','button[data-action="publish-snapshot"]');
const btnHeartbeat= pick('#btnHeartbeat','button[data-action="publish-heartbeat"]');

// 映射 CSV
const elMapBook   = pick('#map_bookmakers', 'input[name="map_bookmakers"]');
const elMapLeaId  = pick('#map_leagues_id', 'input[name="map_leagues_id"]');
const elMapTeamId = pick('#map_teams_id',   'input[name="map_teams_id"]');
const elMapLeaEn  = pick('#map_leagues_en', 'input[name="map_leagues_en"]');
const elMapTeamEn = pick('#map_teams_en',   'input[name="map_teams_en"]');
const btnMapsLoad = pick('#btnMapsLoad',    'button[data-action="maps-load"]');

// 上表/下表 & 过滤/导出
const btnAddAll   = pick('#btnAddAll',      'button[data-action="raw-add-all"]');
const btnClearRaw = pick('#btnClearRaw',    'button[data-action="raw-clear"]');
const btnApply    = pick('#btnApplyFilters','button[data-action="apply-filters"]');
const btnClear    = pick('#btnClearFilters','button[data-action="clear-filters"]');
const btnExport   = pick('#btnExport',      'button[data-action="export-json"]');

// 表格 tbody
const elRawBody   = pick('#rawTbody', 'tbody#rawBody', 'tbody[data-role="raw"]');
const elPubBody   = pick('#pubTbody', 'tbody#pubBody', 'tbody[data-role="pub"]');

// 过滤控件（尽量回退）
const selPubSource= pick('#pubSource','select[name="pubSource"]');
const selPubMarket= pick('#pubMarket','select[name="pubMarket"]');
const selPubPeriod= pick('#pubPeriod','select[name="pubPeriod"]');

/* ========================== Renderers ========================== */
function renderRawTable() {
  if (!elRawBody) return;
  elRawBody.innerHTML = '';
  for (const r of store.rawRows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.event_id || ''}</td>
      <td>${r.source || ''}</td>
      <td>${r.league || ''}</td>
      <td>${r.home || ''}</td>
      <td>${r.away || ''}</td>
      <td>${r.period || ''}</td>
      <td>${r.market || ''}</td>
      <td>${r.line_text || ''}</td>
      <td>${jsonStringSafe(r.pickA || '')}</td>
      <td>${jsonStringSafe(r.pickB || '')}</td>
    `.trim();
    elRawBody.appendChild(tr);
  }
}

function renderPubTable() {
  if (!elPubBody) return;
  // 简单过滤
  let rows = store.pubRows;
  const src = selPubSource?.value || '全部';
  const mk  = selPubMarket?.value || '全部';
  const prd = selPubPeriod?.value || '全部';
  rows = rows.filter(r => {
    if (src !== '全部' && r.source !== src) return false;
    if (mk  !== '全部' && r.market !== mk) return false;
    if (prd !== '全部' && r.period !== prd) return false;
    return true;
  });

  elPubBody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.event_id || ''}</td>
      <td>${r.source || ''}</td>
      <td>${r.league || ''}</td>
      <td>${r.home || ''}</td>
      <td>${r.away || ''}</td>
      <td>${r.period || ''}</td>
      <td>${r.market || ''}</td>
      <td>${r.line_text || ''}</td>
      <td>${jsonStringSafe(r.pickA || '')}</td>
      <td>${jsonStringSafe(r.pickB || '')}</td>
    `.trim();
    elPubBody.appendChild(tr);
  }
}

/* ========================== Mock / 映射 ========================== */
async function loadMock() {
  try {
    const res = await fetch('./mock.json', { cache: 'no-store' });
    const json = await res.json();
    // 期待结构：[{event_id, source, league, home, away, period, market, line_text, pickA, pickB}, ...]
    store.rawRows = Array.isArray(json) ? json : (json.data || []);
    addLog('INFO', '载入 Mock 数据', { count: store.rawRows.length });
    renderRawTable();
  } catch (e) {
    addLog('ERROR', '载入 Mock 失败', e?.message || String(e));
  }
}

async function fetchCSV(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txt = await res.text();
  // 简陋 CSV -> map，按第一列 id/英文、第二列 中文
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const map = {};
  for (const ln of lines) {
    const [k, v] = ln.split(',').map(s=>s?.trim());
    if (k) map[k] = v ?? '';
  }
  return map;
}

async function loadMappings() {
  const jobs = [];
  // id 映射
  if (elMapBook?.value) jobs.push(fetchCSV(elMapBook.value).then(m=>store.maps.id.bookmakers=m));
  if (elMapLeaId?.value) jobs.push(fetchCSV(elMapLeaId.value).then(m=>store.maps.id.leagues=m));
  if (elMapTeamId?.value) jobs.push(fetchCSV(elMapTeamId.value).then(m=>store.maps.id.teams=m));
  // 英文 -> 中文
  if (elMapLeaEn?.value) jobs.push(fetchCSV(elMapLeaEn.value).then(m=>store.maps.en.leagues=m));
  if (elMapTeamEn?.value) jobs.push(fetchCSV(elMapTeamEn.value).then(m=>store.maps.en.teams=m));

  if (!jobs.length) {
    addLog('WARN', '未填写任何 CSV 路径，跳过加载');
    return;
  }
  try {
    await Promise.all(jobs);
    addLog('INFO', '映射包已加载/刷新');
  } catch (e) {
    addLog('ERROR', '映射包加载失败', e?.message || String(e));
  }
}

/* ========================== Server -> F：原始流连接 ========================== */
function connectSource() {
  const url   = (elSrcUrl?.value || '').trim();
  const token = (elSrcToken?.value || '').trim();

  if (!url) { alert('请填写 原始 WSS URL'); return; }

  try {
    if (store.wsSrc) { try { store.wsSrc.close(); } catch {} store.wsSrc = null; }

    // 可选：token 通过 ?token=xxx 拼到 URL；也可在首帧发
    const u = new URL(url);
    if (token) u.searchParams.set('token', token);

    const ws = new WebSocket(u.toString());
    store.wsSrc = ws;

    ws.onopen = () => {
      addLog('INFO', 'src 打开', { url: u.toString() });
      // 若服务端用首帧 auth，这里再发一次也无妨
      if (token) ws.send(jsonStringSafe({ type:'auth', token }));
    };

    ws.onmessage = (ev) => {
      const payload = jsonParseSafe(ev.data, ev.data);
      // 兼容几种形态：数组即快照 / {type:'snapshot', data:[...]} / {type:'opportunity', data:{...}}
      if (Array.isArray(payload)) {
        store.rawRows = payload;
        addLog('DEBUG', 'src 快照(数组)', { count: payload.length });
        renderRawTable();
      } else if (payload && typeof payload === 'object') {
        if (payload.type === 'snapshot' && Array.isArray(payload.data)) {
          store.rawRows = payload.data;
          addLog('DEBUG', 'src 快照', { count: payload.data.length });
          renderRawTable();
        } else if (payload.type === 'opportunity' && payload.data) {
          // 增量追加（你也可以按 event_id 去重/合并）
          store.rawRows.unshift(payload.data);
          renderRawTable();
        } else if (payload.type === 'heartbeat') {
          // 心跳仅记日志
        } else {
          // 其它：当做通用日志
          addLog('DEBUG', 'src 消息', payload);
        }
      }
    };

    ws.onclose = (ev) => {
      addLog('WARN', 'src 断开', { code: ev.code, reason: ev.reason });
      store.wsSrc = null;
    };
    ws.onerror = (err) => {
      addLog('ERROR', 'src 错误', err?.message || String(err));
    };
  } catch (e) {
    addLog('ERROR', 'src 连接异常', e?.message || String(e));
  }
}

function disconnectSource() {
  if (store.wsSrc) {
    try { store.wsSrc.close(1000, 'by user'); } catch {}
    store.wsSrc = null;
    addLog('INFO', 'src 已断开');
  }
}

/* ========================== F -> 发布端：不强制 token ========================== */
function buildPublisherUrl(raw, token) {
  const u = new URL(raw);
  u.searchParams.set('role', 'publisher'); // 关键：明确身份
  if (token) u.searchParams.set('token', token);
  return u.toString();
}

function connectPublisher() {
  const pubUrl   = (elPubUrl?.value || '').trim();
  const pubToken = (elPubToken?.value || '').trim(); // 可空

  if (!pubUrl) { alert('请填写 发布 WSS URL'); return; }

  try {
    if (store.wsPub) { try { store.wsPub.close(); } catch {} store.wsPub = null; }

    const finalUrl = buildPublisherUrl(pubUrl, pubToken);
    const ws = new WebSocket(finalUrl);
    store.wsPub = ws;

    ws.onopen = () => {
      // 首帧再发一次 auth（无 token 也允许）
      ws.send(jsonStringSafe({ type:'auth', role:'publisher', token: pubToken || '' }));
      addLog('INFO', 'pub 打开', { url: finalUrl });
    };

    ws.onmessage = (ev) => {
      addLog('DEBUG', '发布端消息', jsonParseSafe(ev.data, ev.data));
    };

    ws.onclose = (ev) => {
      addLog('WARN', 'pub 断开', { code: ev.code, reason: ev.reason });
      store.wsPub = null;
    };

    ws.onerror = (err) => {
      addLog('ERROR', 'pub 错误', err?.message || String(err));
    };
  } catch (e) {
    addLog('ERROR', 'pub 连接异常', e?.message || String(e));
  }
}

function disconnectPublisher() {
  if (store.wsPub) {
    try { store.wsPub.close(1000, 'by user'); } catch {}
    store.wsPub = null;
    addLog('INFO', 'pub 已断开');
  }
}

/* ========================== 发布：Snapshot / Heartbeat ========================== */
function publishSnapshot() {
  if (!store.wsPub || store.wsPub.readyState !== 1) {
    alert('发布端未连接'); return;
  }
  if (!store.pubRows.length) {
    alert('下表为空，无数据可发'); return;
  }
  const payload = { type:'snapshot', data: store.pubRows };
  store.wsPub.send(jsonStringSafe(payload));
  addLog('INFO', '已发送 Snapshot', { count: store.pubRows.length });
}

function publishHeartbeat() {
  if (!store.wsPub || store.wsPub.readyState !== 1) return;
  const payload = { type:'heartbeat', ts: Date.now() };
  store.wsPub.send(jsonStringSafe(payload));
  addLog('DEBUG', '已发送 Heartbeat');
}

/* ========================== 上表→下表 / 过滤 / 导出 ========================== */
function addAllToPublish() {
  store.pubRows = store.rawRows.slice();
  renderPubTable();
  addLog('INFO', '已将上表全部加入下表', { count: store.pubRows.length });
}

function clearRaw() {
  store.rawRows = [];
  renderRawTable();
  addLog('INFO', '上表已清空');
}

function applyFilters() {
  renderPubTable();
}

function clearFilters() {
  if (selPubSource) selPubSource.value = '全部';
  if (selPubMarket) selPubMarket.value = '全部';
  if (selPubPeriod) selPubPeriod.value = '全部';
  renderPubTable();
}

function exportJSON() {
  const blob = new Blob([jsonStringSafe(store.pubRows)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.json';
  a.click();
  URL.revokeObjectURL(url);
  addLog('INFO', 'export.json 已下载', { count: store.pubRows.length });
}

/* ========================== Event Bindings ========================== */
// Server -> F
btnSrcConn && btnSrcConn.addEventListener('click', connectSource);
btnSrcOff  && btnSrcOff.addEventListener('click', disconnectSource);
btnMockToggle && btnMockToggle.addEventListener('click', loadMock);

// F -> 发布端
btnPubConn && btnPubConn.addEventListener('click', connectPublisher);
btnPubOff  && btnPubOff.addEventListener('click', disconnectPublisher);
btnSnapshot && btnSnapshot.addEventListener('click', publishSnapshot);
btnHeartbeat&& btnHeartbeat.addEventListener('click', publishHeartbeat);

// 映射
btnMapsLoad && btnMapsLoad.addEventListener('click', loadMappings);

// 上表/下表/过滤/导出
btnAddAll   && btnAddAll.addEventListener('click', addAllToPublish);
btnClearRaw && btnClearRaw.addEventListener('click', clearRaw);
btnApply    && btnApply.addEventListener('click', applyFilters);
btnClear    && btnClear.addEventListener('click', clearFilters);
btnExport   && btnExport.addEventListener('click', exportJSON);

// 初次渲染（若页面有默认 Mock/数据，可自动渲染一次）
renderRawTable();
renderPubTable();
addLog('INFO', 'F 端已就绪（app.js loaded）');
