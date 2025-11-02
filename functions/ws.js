// Cloudflare Pages Functions single WS endpoint: /ws
// 角色：publisher（F端发布） / viewer（A端只读）

const clients = {
  publishers: new Set(),
  viewers: new Set(),
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket', { status: 400 });
  }

  // Origin 白名单（可选）
  const allow = (env.ALLOW_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (allow.length) {
    const origin = request.headers.get('Origin') || '';
    if (origin && !allow.includes(origin)) {
      return new Response('origin not allowed', { status: 403 });
    }
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  const url = new URL(request.url);
  const meta = { ip: request.headers.get('CF-Connecting-IP') || 'unknown' };

  // URL 里的快速声明（可选）
  let role = (url.searchParams.get('role') || '').toLowerCase() || 'viewer';
  let token = url.searchParams.get('token') || '';

  // 工具函数
  const sendJSON = (ws, obj) => {
    try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch {}
  };
  const closeWith = (ws, code = 1008, reason = 'bye') => {
    try { ws.close(code, reason); } catch {}
  };
  const broadcastToViewers = (obj) => {
    const msg = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const ws of clients.viewers) {
      try { ws.send(msg); } catch {}
    }
  };
  const enterAsPublisher = () => {
    role = 'publisher';
    clients.publishers.add(server);
    sendJSON(server, { type: 'ok', role, ip: meta.ip });
  };
  const enterAsViewer = () => {
    role = 'viewer';
    clients.viewers.add(server);
    sendJSON(server, { type: 'ok', role, ip: meta.ip });
  };

  // —— 首次根据 URL 参数尝试放行（可选，未设置 token 环境变量时不校验）——
  const tryEnterByQuery = () => {
    if (role === 'publisher') {
      // 仅当配置了 PUBLISH_TOKEN 才验证；否则不校验直接放行
      if (env.PUBLISH_TOKEN && token !== env.PUBLISH_TOKEN) {
        sendJSON(server, { type: 'error', msg: 'auth failed' });
        closeWith(server, 1008, 'auth failed');
        return false;
      }
      enterAsPublisher();
      return true;
    }
    // viewer
    if (env.READ_TOKEN && token !== env.READ_TOKEN) {
      sendJSON(server, { type: 'error', msg: 'auth failed' });
      closeWith(server, 1008, 'auth failed');
      return false;
    }
    enterAsViewer();
    return true;
  };

  // 尝试按 URL 直接进入（默认 viewer）
  if (!tryEnterByQuery()) {
    return new Response(null, { status: 101, webSocket: client });
  }

  // —— WS 事件 —— //
  server.addEventListener('message', (ev) => {
    let data = ev.data;
    try { data = JSON.parse(ev.data); } catch {}

    // 首帧/重复鉴权（以最后一次为准）
    if (data && data.type === 'auth') {
      const wantRole = (data.role || '').toLowerCase() || 'viewer';
      const tok = data.token || '';

      if (wantRole === 'publisher') {
        if (env.PUBLISH_TOKEN && tok !== env.PUBLISH_TOKEN) {
          sendJSON(server, { type: 'error', msg: 'auth failed' });
          closeWith(server, 1008, 'auth failed');
          return;
        }
        // 切换角色时要从集合里迁移
        clients.viewers.delete(server);
        enterAsPublisher();
        return;
      } else {
        if (env.READ_TOKEN && tok !== env.READ_TOKEN) {
          sendJSON(server, { type: 'error', msg: 'auth failed' });
          closeWith(server, 1008, 'auth failed');
          return;
        }
        clients.publishers.delete(server);
        enterAsViewer();
        return;
      }
    }

    // 心跳
    if (data === 'ping' || (data && data.type === 'ping')) {
      sendJSON(server, { type: 'pong', ts: Date.now() });
      return;
    }

    // 仅 publisher 可发布
    if (role === 'publisher') {
      // 支持 snapshot / opportunity / heartbeat 或数组转发
      if (Array.isArray(data)) {
        for (const item of data) broadcastToViewers(item);
        return;
      }
      if (
        data &&
        (data.type === 'snapshot' ||
         data.type === 'opportunity' ||
         data.type === 'heartbeat' ||
         data.type === 'message')
      ) {
        broadcastToViewers(data);
      }
      return;
    }

    // viewer 消息忽略
  });

  server.addEventListener('close', () => {
    clients.publishers.delete(server);
    clients.viewers.delete(server);
  });

  return new Response(null, { status: 101, webSocket: client });
}
