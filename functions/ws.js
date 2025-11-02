// Cloudflare Pages Functions single WS endpoint: /ws
// 角色：publisher（F端） 可发布；viewer（A端） 只读
const clients = {
  publishers: new Set(),
  viewers: new Set(),
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  const url = new URL(request.url);
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();
  let role = 'viewer';
  const meta = { ip: request.headers.get('CF-Connecting-IP') || 'unknown' };

  function closeAll(reason) {
    try { server.close(1000, reason || 'done'); } catch {}
  }

  function broadcastToViewers(obj) {
    const msg = typeof obj==='string' ? obj : JSON.stringify(obj);
    for (const ws of clients.viewers) {
      try { ws.send(msg); } catch {}
    }
  }

  server.addEventListener('message', (ev) => {
    let data = ev.data;
    try { data = JSON.parse(ev.data); } catch {}

    // 首帧鉴权（可多次发；以最后一次为准）
    if (data && data.type === 'auth') {
      if (data.role === 'publisher') {
        const ok = !!env.PUBLISH_TOKEN && data.token === env.PUBLISH_TOKEN;
        if (!ok) {
          try { server.send(JSON.stringify({type:'error', msg:'auth failed'})); } catch {}
          closeAll('auth failed');
          return;
        }
        role = 'publisher';
        clients.publishers.add(server);
        try { server.send(JSON.stringify({type:'ok', role})); } catch {}
        return;
      } else {
        // viewer 可选 token；若 env.READ_TOKEN 存在则校验
        if (env.READ_TOKEN && data.token !== env.READ_TOKEN) {
          try { server.send(JSON.stringify({type:'error', msg:'auth failed'})); } catch {}
          closeAll('auth failed');
          return;
        }
        role = 'viewer';
        clients.viewers.add(server);
        try { server.send(JSON.stringify({type:'ok', role})); } catch {}
        return;
      }
    }

    // 发布消息（仅 publisher 可发）
    if (role === 'publisher') {
      if (data && (data.type === 'snapshot' || data.type === 'opportunity' || data.type === 'heartbeat')) {
        broadcastToViewers(data);
      }
      return;
    }

    // viewer 发来的消息忽略
  });

  server.addEventListener('close', () => {
    clients.publishers.delete(server);
    clients.viewers.delete(server);
  });

  // 允许的 Origin（可选）
  const allow = (env.ALLOW_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
  if (allow.length) {
    const origin = request.headers.get('Origin') || '';
    if (!allow.includes(origin)) {
      try { server.send(JSON.stringify({type:'error', msg:'origin not allowed'})); } catch {}
      closeAll('origin not allowed');
      return new Response(null, { status: 403 });
    }
  }

  return new Response(null, { status: 101, webSocket: client });
}
