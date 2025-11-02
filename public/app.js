/* public/app.js v2 — 最小稳定实现，保证页面不空白、不报错 */
(function () {
  "use strict";

  const $ = s => document.querySelector(s);
  const rawDot = $('#rawDot'), rawText = $('#rawText');
  const pubDot = $('#pubDot'), pubText = $('#pubText');
  const logsEl = $('#logs');

  function setDot(el, ok) {
    if (!el) return;
    el.classList.remove('gray', 'green', 'red');
    el.classList.add(ok ? 'green' : 'red');
  }
  function log(level, msg) {
    if (!logsEl) return;
    const ts = new Date().toTimeString().slice(0,8);
    logsEl.textContent += `[${ts}][${level}] ${msg}\n`;
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  // 暴露给 index.html 的连接函数
  let srcWS = null, pubWS = null;

  window.connectSource = function (url) {
    try { srcWS?.close?.(); } catch (e){}
    log('INFO', `src 打开 ${url}`);
    srcWS = new WebSocket(url);
    srcWS.onopen  = () => { rawText.textContent='已连接'; setDot(rawDot,true);  log('INFO','src open'); };
    srcWS.onclose = () => { rawText.textContent='未连接'; setDot(rawDot,false); log('WARN','src close'); };
    srcWS.onerror = () => { setDot(rawDot,false); log('ERROR','src error'); };
    srcWS.onmessage = (ev)=> {
      // 这里你后续可把数据灌到“上表”
      // 先打印长度避免撑爆日志
      const s = typeof ev.data === 'string' ? ev.data : '[binary]';
      log('DEBUG', `src msg len=${s.length}`);
    };
  };

  window.connectPublisher = function (url) {
    try { pubWS?.close?.(); } catch (e){}
    log('INFO', `pub 打开 ${url}`);
    pubWS = new WebSocket(url);
    pubWS.onopen  = () => { pubText.textContent='已连接'; setDot(pubDot,true);  log('INFO','pub open'); };
    pubWS.onclose = () => { pubText.textContent='未连接'; setDot(pubDot,false); log('WARN','pub close'); };
    pubWS.onerror = () => { setDot(pubDot,false); log('ERROR','pub error'); };
    pubWS.onmessage = (ev)=> {
      // A端连接到这里能收到内容；F端只是发送
      const s = typeof ev.data === 'string' ? ev.data : '[binary]';
      log('DEBUG', `pub msg len=${s.length}`);
    };
  };

  // 三个按钮（如果你以后不走 index 的 hook，也能用）
  $('#btnRawClose')?.addEventListener('click', ()=>{ try { srcWS?.close(); } catch(e){} });
  $('#btnPubClose')?.addEventListener('click', ()=>{ try { pubWS?.close(); } catch(e){} });
  $('#btnPublishBeat')?.addEventListener('click', ()=>{
    if (pubWS?.readyState === 1) {
      pubWS.send(JSON.stringify({type:'heartbeat', ts: Date.now()}));
      log('INFO','pub 发送 heartbeat');
    } else {
      log('WARN','pub 未连接');
    }
  });
  $('#btnPublishSnap')?.addEventListener('click', ()=>{
    if (pubWS?.readyState === 1) {
      const snap = { type:'snapshot', data:[] }; // 这里后续填充“下表”的数据
      pubWS.send(JSON.stringify(snap));
      log('INFO','pub 发送 snapshot');
    } else {
      log('WARN','pub 未连接');
    }
  });

  // 初始化状态点
  if (rawDot) rawDot.classList.add('gray');
  if (pubDot) pubDot.classList.add('gray');
})();
