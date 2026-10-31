# 闪剪台 / FlashCut — Day 1

浏览器原生多轨短视频剪辑台。素材不上传服务器，剪辑与导出均在本地完成。

## 文件

- `index.html` / `styles.css` / `app.js` / `export.js` — 静态前端
- `app.json` — 注册为 `/d01/`

## CDN（ffmpeg.wasm，首次加载需联网）

| 包 | URL |
|---|---|
| `@ffmpeg/ffmpeg` | `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js` |
| `@ffmpeg/util` | `https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js` |
| `@ffmpeg/core` (单线程) | `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js` |
| core wasm | `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm` |

使用**单线程** core，避免 SharedArrayBuffer / COOP-COEP 要求，普通 HTTPS 即可。

备用镜像：把 `cdn.jsdelivr.net/npm` 换成 `unpkg.com`。

## 本地验证

```bash
cd /path/to/daily-apps
PORT=8787 GATE_LOCAL_BYPASS=1 python3 server.py
# 仅 127.0.0.1 可绕过体验码
curl -s http://127.0.0.1:8787/d01/ | head
```

## 能力概览

- 多文件导入（视频 / 图片 / 音频），Object URL，不上传
- 视频轨 + 音频/BGM 轨 + 字幕轨
- 入出点裁剪、重排、删除、图片时长
- 中文字幕预览叠加；导出时以 PNG 烧录进成片
- 转场：硬切 / 交叉溶解
- ffmpeg.wasm 导出 WebM，进度条
- 空状态三步引导；建议 2–3 个短片段以省内存
