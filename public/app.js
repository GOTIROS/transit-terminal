/* F端主脚本：全WSS + Mock + 上下表 + 发布到 /ws 广播 */

const $ = (s, d=document)=>d.querySelector(s);
const $$ = (s, d=document)=>Array.from(d.querySelectorAll(s));

/* =============== 日志 =============== */
let LOG_PAUSE = false;
function log(level, msg, obj) {
  const lv = $('#logLevel').value;
  if (lv!=='ALL' && lv!==level) return;
  const line = `[${new Date().toLocaleTimeString()}][${level}] ${msg}` + (obj?` ${JSON.stringify(obj).slice(0,800)}`:'');
  const pre = $('#logs');
  pre.textContent += line + '\n';
  if (!LOG_PAUSE) pre.scrollTop = pre.scrollHeight;
}
$('#btnLogPause').onclick = ()=> LOG_PAUSE = !LOG_PAUSE;
$('#btnLogClear').onclick = ()=> $('#logs').textContent='';
$('#btnLogCopy').onclick = async()=> {
  await navigator.clipboard.writeText($('#logs').textContent||'');
  log('INFO','已复制日志到剪贴板');
};
$('#btnLogDownload').onclick = ()=> {
  const blob = new Blob([$('#logs').textContent||''], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `f-logs-${Date.now()}.txt`;
  a.click();
};

/* =============== 状态灯 =============== */
function paintDot(kind, state) {
  const dot = kind==='raw' ? $('#rawDot') : $('#pubDot');
  const txt = kind==='raw' ? $('#rawText') : $('#pubText');
  const cls = {idle:'gray', connecting:'blue', open:'green', error:'red'}[state] || 'gray';
  dot.className = 'dot '+cls;
  txt.textContent = {idle:'未连接',connecting:'连接中',open:'已连接',error:'错误'}[state] || '未连接';
}

/* =============== WebSocket 客户端（指数回退重连） =============== */
class WSClient {
  constructor(name){ this.name=name; this.ws=null; this.url=''; this.token=''; this.timer=null; this.backoff=1000; this.onmsg=null; }
  connect(url, token, onmsg){
    this.url=url; this.token=token||''; this.onmsg=onmsg;
    this._open();
  }
  _open(){
    if(!this.url){ return; }
    const u = new URL(this.url);
    if (this.token && !u.searchParams.get('token') && !u.searchParams.get('auth_key')) {
      u.searchParams.set('token', this.token);
    }
    const displayUrl = u.toString();
    (this.name==='raw'?paintDot('raw','connecting'):paintDot('pub','connecting'));
    try {
      this.ws = new WebSocket(displayUrl);
    } catch(e) {
      log('ERROR', `${this.name} 构造WS失败`, {e:String(e)});
      return this._retry();
    }
    this.ws.onopen = ()=>{
      this.backoff = 1000;
      (this.name==='raw'?paintDot('raw','open'):paintDot('pub','open'));
      log('INFO', `${this.name} 打开`, {url:displayUrl});
      // 发布端在 onopen 后立刻做 auth（publisher）
      if (this.name==='pub' && this.token) {
        this.send({type:'auth', role:'publisher', token:this.token});
      }
    };
    this.ws.onmessage = (ev)=>{
      let data = ev.data;
      try { data = JSON.parse(ev.data); } catch {}
      this.onmsg && this.onmsg(data);
    };
    this.ws.onerror = (e)=>{
      (this.name==='raw'?paintDot('raw','error'):paintDot('pub','error'));
      log('ERROR', `${this.name} 错误`, {e:String(e)});
    };
    this.ws.onclose = ()=>{
      (this.name==='raw'?paintDot('raw','error'):paintDot('pub','error'));
      log('WARN', `${this.name} 断开，准备重连`, {backoff:this.backoff});
      this._retry();
    };
  }
  _retry(){
    clearTimeout(this.timer);
    const t = this.backoff + Math.floor(Math.random()*this.backoff*0.2);
    this.timer = setTimeout(()=>this._open(), Math.min(t, 30000));
    this.backoff = Math.min(this.backoff*2, 30000);
  }
  close(){
    clearTimeout(this.timer);
    try{ this.ws && this.ws.close(); }catch{}
    this.ws=null; (this.name==='raw'?paintDot('raw','idle'):paintDot('pub','idle'));
  }
  send(obj){
    if (this.ws && this.ws.readyState===1) this.ws.send(JSON.stringify(obj));
  }
}
const rawWS = new WSClient('raw');
const pubWS = new WSClient('pub');

/* =============== 数据存储与表格渲染 =============== */
let MOCK_ON = false;
let rawRows = [];        // 原始条目（源头直接展示）
let publishRows = [];    // 发布表（筛选/汉化后）
let currentTab = 'all';  // raw 表当前 Tab

function autoHeaders(rows){
  if (!rows.length) return [];
  const keys = new Set();
  rows.slice(0,100).forEach(r=>Object.keys(r||{}).forEach(k=>keys.add(k)));
  return Array.from(keys);
}
function renderTable(elTable, rows){
  const thead = elTable.querySelector('thead');
  const tbody = elTable.querySelector('tbody');
  tbody.innerHTML = '';
  const keys = autoHeaders(rows);
  thead.innerHTML = '<tr>'+keys.map(k=>`<th>${k}</th>`).join('')+'</tr>';
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = keys.map(k=>`<td>${escapeHtml(val(r[k]))}</td>`).join('');
    tbody.appendChild(tr);
  });
}
function escapeHtml(s){ return String(s===undefined?'':s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function val(v){
  if (v===null || v===undefined) return '';
  if (typeof v==='object') return JSON.stringify(v);
  return v;
}

/* 过滤器（简单版） */
function applyFilter(){
  const src = $('#f_source').value.trim();
  const mkt = $('#f_market').value.trim();
  const per = $('#f_period').value.trim();
  let arr = publishRows.slice();
  if (src) arr = arr.filter(x=> (x.source||'')===src);
  if (mkt) arr = arr.filter(x=> (x.market||'')===mkt);
  if (per) arr = arr.filter(x=> (x.period||'')===per);
  renderTable($('#pubTable'), arr);
}
$('#btnApplyFilter').onclick = applyFilter;
$('#btnClearFilter').onclick = ()=>{ $('#f_source').value=''; $('#f_market').value=''; $('#f_period').value=''; applyFilter(); };
$('#btnClearPublish').onclick = ()=>{ publishRows=[]; applyFilter(); };
$('#btnDownloadJson').onclick = ()=>{
  const blob = new Blob([JSON.stringify(publishRows,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'export.json';
  a.click();
};

/* Tabs */
$$('.tab').forEach(btn=>{
  btn.onclick = ()=>{
    $$('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    refreshRawTable();
  };
});
function refreshRawTable(){
  const total = rawRows.length;
  $('#rawCount').textContent = String(total);
  let arr = rawRows;
  if (currentTab==='isp') arr = rawRows.filter(x=>x.source==='isp');
  if (currentTab==='pm') arr = rawRows.filter(x=>x.source==='pm');
  renderTable($('#rawTable'), arr);
}

/* =============== 映射（CSV） =============== */
let maps = { book:{}, league:{}, team:{}, enLeague:{}, enTeam:{} };
async function loadCsv(url){
  const res = await fetch(url, {cache:'no-store'});
  if (!res.ok) throw new Error(`load csv failed: ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = lines.map(l=>l.split(',').map(s=>s.trim()));
  return rows;
}
async function loadMappings(){
  const mbook = $('#m_book').value || '/mappings/id/bookmakers.csv';
  const mleag = $('#m_league').value || '/mappings/id/leagues.csv';
  const mteam = $('#m_team').value || '/mappings/id/teams.csv';
  const mleEn = $('#m_league_en').value || '/mappings/en/leagues_en2cn.csv';
  const mteEn = $('#m_team_en').value || '/mappings/en/teams_en2cn.csv';
  try{
    const [book,leag,team, enL,enT] = await Promise.all([
      loadCsv(mbook), loadCsv(mleag), loadCsv(mteam), loadCsv(mleEn), loadCsv(mteEn)
    ]);
    maps.book = objByFirstCol(book);
    maps.league = objByFirstCol(leag);
    maps.team = objByFirstCol(team);
    maps.enLeague = objByFirstCol(enL);
    maps.enTeam = objByFirstCol(enT);
    $('#mapStatus').textContent = '已加载';
    log('INFO','映射加载完成');
  }catch(e){
    $('#mapStatus').textContent = '加载失败';
    log('ERROR','映射加载失败', {e:String(e)});
  }
}
function objByFirstCol(rows){
  const o={}; rows.forEach(r=>{ if(r.length>=2) o[r[0]]=r[1]; });
  return o;
}
$('#btnLoadMaps').onclick = loadMappings;

/* =============== 原始流接入 =============== */
$('#btnRawConnect').onclick = ()=>{
  const url = ($('#rawUrl').value||'').trim();
  const token = ($('#rawToken').value||'').trim();
  if (!url) return alert('请填写原始 WSS URL');
  rawWS.connect(url, token, onRawMessage);
};
$('#btnRawClose').onclick = ()=> rawWS.close();
$('#btnClearRaw').onclick = ()=>{ rawRows=[]; refreshRawTable(); };

function onRawMessage(payload){
  // 兼容多种：数组 / {type:'raw'|'snapshot'|'heartbeat'|...}
  if (Array.isArray(payload)) {
    payload.forEach(x=>ingestRaw(x));
    refreshRawTable();
    return;
  }
  if (payload && payload.type==='raw' && Array.isArray(payload.data)) {
    payload.data.forEach(x=>ingestRaw(x, payload.source));
    refreshRawTable();
    return;
  }
  if (payload && payload.type==='snapshot' && Array.isArray(payload.data)) {
    payload.data.forEach(x=>ingestRaw(x));
    refreshRawTable();
    return;
  }
  if (payload && payload.type==='heartbeat') {
    log('DEBUG','原始心跳', payload);
    return;
  }
  // 不识别的也直接尝试塞一条
  if (payload) {
    ingestRaw(payload);
    refreshRawTable();
  }
}
function ingestRaw(x, src){
  const item = {...x};
  if (!item.source && src) item.source = src;
  rawRows.push(item);
}

/* 将当前 Tab 全部加入下表候选（简单复制；映射可在后续增量中应用） */
$('#btnAllToPublish').onclick = ()=>{
  let arr = rawRows;
  if (currentTab==='isp') arr = rawRows.filter(x=>x.source==='isp');
  if (currentTab==='pm') arr = rawRows.filter(x=>x.source==='pm');
  // 这里可在未来加入映射：ID→中文 / 英文→中文
  publishRows.push(...arr);
  applyFilter();
};

/* =============== 发布端（F → /ws → A） =============== */
$('#btnPubConnect').onclick = ()=>{
  const url = ($('#pubUrl').value||'').trim();
  const tok = ($('#pubToken').value||'').trim();
  if (!url || !tok) return alert('请填写 发布 WSS URL 与 PUBLISH_TOKEN');
  pubWS.connect(url, tok, onPubMessage);
};
$('#btnPubClose').onclick = ()=> pubWS.close();
$('#btnPublishSnap').onclick = ()=>{
  pubWS.send({ type:'snapshot', version:'v1', data: publishRows });
  log('INFO','已发送 snapshot', {count: publishRows.length});
};
$('#btnPublishBeat').onclick = ()=> pubWS.send({ type:'heartbeat', ts: Date.now() });
function onPubMessage(msg){
  // 当前发布端主要接收服务端确认/心跳/错误
  log('DEBUG','发布端消息', msg);
}

/* =============== Mock 开关（离线演示） =============== */
$('#btnToggleMock').onclick = async ()=>{
  MOCK_ON = !MOCK_ON;
  $('#mockBadge').textContent = `Mock: ${MOCK_ON?'ON':'OFF'}`;
  if (MOCK_ON) {
    try{
      const res = await fetch('./mock.json?ts='+Date.now());
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data.data)? data.data : []);
      rawRows = [];
      arr.forEach(x=>ingestRaw(x));
      refreshRawTable();
      log('INFO','已载入 Mock 数据', {count: arr.length});
    }catch(e){
      log('ERROR','Mock 加载失败', {e:String(e)});
    }
  } else {
    log('INFO','Mock 已关闭');
  }
};

/* =============== 启动信息 =============== */
window.addEventListener('load', ()=>{
  $('#buildInfo').textContent = `build=${window.__BUILD_SHA__ || 'dev'}`;
  paintDot('raw','idle'); paintDot('pub','idle');
  // 默认映射路径
  $('#m_book').value = '/mappings/id/bookmakers.csv';
  $('#m_league').value = '/mappings/id/leagues.csv';
  $('#m_team').value = '/mappings/id/teams.csv';
  $('#m_league_en').value = '/mappings/en/leagues_en2cn.csv';
  $('#m_team_en').value = '/mappings/en/teams_en2cn.csv';
});
