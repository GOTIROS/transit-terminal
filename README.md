# F 端（feed.youdatan.com）最小骨架

- 全 WSS：Server→F（原始）、F→/ws→A（发布）
- Cloudflare Pages 托管 `/public`，Pages Functions 暴露 `/ws` 广播端点
- 少目录、好维护：`public/`、`mappings/`、`functions/`

## 部署步骤
1) 绑定仓库到 Cloudflare Pages  
   - Framework = None  
   - Build command = （空）  
   - Output = `public`  
   - 开启 Pages Functions（`functions/ws.js`）

2) 环境变量（Production/Preview）
   - `PUBLISH_TOKEN`：F 端发布必填
   - `READ_TOKEN`：（可选）A 端订阅校验
   - `ALLOW_ORIGINS`：`https://feed.youdatan.com,https://app.youdatan.com`

3) 连接口径
   - 原始：`wss://46.151.33.170/ws/raw`（Server 提供）
   - 发布：`wss://feed.youdatan.com/ws`（本项目提供）

4) 本地调试
   - 打开 `https://<pages-preview-domain>` →  
     - Mock 开：直接用 `public/mock.json` 驱动 UI  
     - 连接发布：填 `wss://feed.youdatan.com/ws` + `PUBLISH_TOKEN` → 点击发布 Snapshot

## 消息协议
- Server→F：`welcome` / `heartbeat` / `raw{source,seq,batchId,data}` / 数组
- F→/ws：`auth{role:'publisher',token}` → `snapshot{data}` / `opportunity{data}` / `heartbeat`
- /ws→A：`snapshot` / `opportunity` / `heartbeat`
