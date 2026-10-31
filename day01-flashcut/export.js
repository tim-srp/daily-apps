/**
 * FlashCut export via ffmpeg.wasm (CDN, single-thread core).
 * Chinese subtitles burned via canvas→PNG overlays (no CJK font in wasm).
 */
const FFMPEG_CDN = {
  ffmpeg: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js",
  util: "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js",
  coreURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
  wasmURL: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
};

const W = 720, H = 1280, FPS = 24;

let _ffmpeg = null;
let _loadPromise = null;
let _aborted = false;

export function abortExport() { _aborted = true; }

async function loadFFmpeg(onProgress) {
  if (_ffmpeg?.loaded) return _ffmpeg;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    onProgress?.(2, "正在从 CDN 加载 ffmpeg.wasm…");
    const { FFmpeg } = await import(FFMPEG_CDN.ffmpeg);
    const { toBlobURL } = await import(FFMPEG_CDN.util);
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      // keep quiet; useful for debug
      if (message && /error|Error|Invalid/i.test(message)) console.warn("[ffmpeg]", message);
    });
    ffmpeg.on("progress", ({ progress }) => {
      if (typeof progress === "number" && progress >= 0 && progress <= 1) {
        onProgress?.(55 + Math.round(progress * 40), "正在编码成片…");
      }
    });
    onProgress?.(8, "下载核心引擎（约 25MB，仅首次）…");
    const coreURL = await toBlobURL(FFMPEG_CDN.coreURL, "text/javascript");
    const wasmURL = await toBlobURL(FFMPEG_CDN.wasmURL, "application/wasm");
    onProgress?.(18, "初始化引擎…");
    await ffmpeg.load({ coreURL, wasmURL });
    _ffmpeg = ffmpeg;
    onProgress?.(22, "引擎就绪");
    return ffmpeg;
  })();
  try {
    return await _loadPromise;
  } catch (e) {
    _loadPromise = null;
    throw e;
  }
}

async function fetchFile(url) {
  const { fetchFile } = await import(FFMPEG_CDN.util);
  return fetchFile(url);
}

function extOf(name, type) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  if (m) return m[1].toLowerCase();
  if (type?.startsWith("image/")) return (type.split("/")[1] || "png").replace("jpeg", "jpg");
  if (type?.startsWith("audio/")) return "mp3";
  return "mp4";
}

/** Render Chinese subtitle cue to transparent PNG bytes via canvas */
async function subtitlePng(text, width = W) {
  const canvas = document.createElement("canvas");
  const h = 120;
  canvas.width = width;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, h);
  ctx.font = "bold 36px 'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // soft shadow / outline for readability
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  ctx.fillStyle = "#fff";
  const lines = wrapText(ctx, text, width - 48);
  const lineH = 42;
  const startY = h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    const y = startY + i * lineH;
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
  });
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function wrapText(ctx, text, maxW) {
  const chars = [...(text || "")];
  const lines = [];
  let cur = "";
  for (const ch of chars) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = ch;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

/**
 * Export project to WebM.
 * @param {object} project { mediaMap, videoClips, audioClips, subtitles, defaultTransition }
 * @param {(pct:number, msg:string)=>void} onProgress
 * @returns {Promise<Blob>}
 */
export async function exportProject(project, onProgress = () => {}) {
  _aborted = false;
  const { mediaMap, videoClips, audioClips, subtitles } = project;
  if (!videoClips.length) throw new Error("时间轴上还没有视频或图片片段");

  const ffmpeg = await loadFFmpeg(onProgress);
  if (_aborted) throw new Error("已取消");

  // Clean MEMFS leftovers from prior runs
  try {
    const files = await ffmpeg.listDir("/");
    for (const f of files) {
      if (f.name === "." || f.name === "..") continue;
      try { await ffmpeg.deleteFile(f.name); } catch (_) {}
    }
  } catch (_) {}

  onProgress?.(25, "写入素材到虚拟磁盘…");

  // Prepare each video/image clip as a normalized segment seg_N.webm
  const segNames = [];
  for (let i = 0; i < videoClips.length; i++) {
    if (_aborted) throw new Error("已取消");
    const clip = videoClips[i];
    const media = mediaMap.get(clip.mediaId);
    if (!media) throw new Error("缺少素材：" + clip.mediaId);
    const pct = 25 + Math.round((i / videoClips.length) * 20);
    onProgress?.(pct, `处理片段 ${i + 1}/${videoClips.length}…`);

    const inExt = extOf(media.name, media.mime);
    const inName = `in_${i}.${inExt}`;
    const outName = `seg_${i}.webm`;
    const data = await fetchFile(media.url);
    await ffmpeg.writeFile(inName, data);

    const dur = Math.max(0.1, clip.duration);
    const ss = Math.max(0, clip.inPoint || 0);

    if (media.kind === "image") {
      await ffmpeg.exec([
        "-loop", "1", "-t", dur.toFixed(3), "-i", inName,
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},format=yuv420p`,
        "-c:v", "libvpx-vp9", "-b:v", "1M", "-an", "-y", outName,
      ]);
    } else {
      await ffmpeg.exec([
        "-ss", ss.toFixed(3), "-t", dur.toFixed(3), "-i", inName,
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${FPS},format=yuv420p`,
        "-c:v", "libvpx-vp9", "-b:v", "1.2M", "-an", "-y", outName,
      ]);
    }
    segNames.push({ name: outName, duration: dur, transition: clip.transition || "cut" });
    try { await ffmpeg.deleteFile(inName); } catch (_) {}
  }

  onProgress?.(48, "拼接时间轴…");

  let videoOut = "timeline_v.webm";
  if (segNames.length === 1) {
    // rename/copy
    const data = await ffmpeg.readFile(segNames[0].name);
    await ffmpeg.writeFile(videoOut, data);
  } else {
    // Prefer xfade chain when any crossfade; else concat demuxer
    const useXfade = segNames.some((s, idx) => idx > 0 && s.transition === "crossfade");
    if (useXfade) {
      // Build filter: [0][1]xfade=...[v01]; [v01][2]xfade=...
      const inputs = [];
      segNames.forEach((s) => { inputs.push("-i", s.name); });
      let filter = "";
      let lastLabel = "[0:v]";
      let offset = 0;
      const fade = 0.4;
      for (let i = 1; i < segNames.length; i++) {
        offset += segNames[i - 1].duration;
        const tr = segNames[i].transition === "crossfade" ? "fade" : "fade"; // cut approximated with very short fade or concat
        const isFade = segNames[i].transition === "crossfade";
        const d = isFade ? fade : 0.01;
        const off = Math.max(0, offset - (isFade ? fade : 0));
        const outLabel = i === segNames.length - 1 ? "[vout]" : `[v${i}]`;
        filter += `${lastLabel}[${i}:v]xfade=transition=${isFade ? "fade" : "fade"}:duration=${d}:offset=${off.toFixed(3)}${outLabel};`;
        lastLabel = outLabel;
        if (isFade) offset -= fade;
      }
      filter = filter.replace(/;$/, "");
      await ffmpeg.exec([
        ...inputs,
        "-filter_complex", filter,
        "-map", "[vout]",
        "-c:v", "libvpx-vp9", "-b:v", "1.2M", "-an", "-y", videoOut,
      ]);
    } else {
      // concat demuxer
      let list = "";
      for (const s of segNames) list += `file '${s.name}'\n`;
      await ffmpeg.writeFile("list.txt", list);
      await ffmpeg.exec([
        "-f", "concat", "-safe", "0", "-i", "list.txt",
        "-c", "copy", "-y", videoOut,
      ]);
    }
  }

  if (_aborted) throw new Error("已取消");
  onProgress?.(58, "混合音频…");

  // Audio mix from A track (optional) + original? We only use A-track BGM/clips for simplicity
  let hasAudio = false;
  const audioParts = [];
  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i];
    const media = mediaMap.get(clip.mediaId);
    if (!media) continue;
    const inExt = extOf(media.name, media.mime);
    const inName = `ain_${i}.${inExt}`;
    const outName = `a_${i}.wav`;
    const data = await fetchFile(media.url);
    await ffmpeg.writeFile(inName, data);
    const ss = Math.max(0, clip.inPoint || 0);
    const dur = Math.max(0.1, clip.duration);
    const delayMs = Math.round((clip.start || 0) * 1000);
    await ffmpeg.exec([
      "-ss", ss.toFixed(3), "-t", dur.toFixed(3), "-i", inName,
      "-ar", "44100", "-ac", "2", "-y", outName,
    ]);
    audioParts.push({ name: outName, delayMs });
    hasAudio = true;
    try { await ffmpeg.deleteFile(inName); } catch (_) {}
  }

  let avOut = "av.webm";
  if (hasAudio && audioParts.length) {
    // adelay + amix
    const inputs = ["-i", videoOut];
    audioParts.forEach((a) => { inputs.push("-i", a.name); });
    let fc = "";
    const labels = [];
    audioParts.forEach((a, i) => {
      const idx = i + 1;
      fc += `[${idx}:a]adelay=${a.delayMs}|${a.delayMs},volume=0.9[a${i}];`;
      labels.push(`[a${i}]`);
    });
    if (labels.length === 1) {
      fc += `${labels[0]}anull[aout]`;
    } else {
      fc += `${labels.join("")}amix=inputs=${labels.length}:dropout_transition=0[aout]`;
    }
    await ffmpeg.exec([
      ...inputs,
      "-filter_complex", fc,
      "-map", "0:v", "-map", "[aout]",
      "-c:v", "copy", "-c:a", "libopus", "-shortest", "-y", avOut,
    ]);
  } else {
    const data = await ffmpeg.readFile(videoOut);
    await ffmpeg.writeFile(avOut, data);
  }

  if (_aborted) throw new Error("已取消");
  onProgress?.(72, "烧录字幕…");

  let finalName = "flashcut.webm";
  const activeSubs = (subtitles || []).filter((s) => (s.text || "").trim());
  if (activeSubs.length) {
    const overlayInputs = ["-i", avOut];
    let fc = "";
    let prev = "[0:v]";
    for (let i = 0; i < activeSubs.length; i++) {
      const s = activeSubs[i];
      const png = await subtitlePng(s.text.trim());
      const pn = `sub_${i}.png`;
      await ffmpeg.writeFile(pn, png);
      overlayInputs.push("-i", pn);
      const start = Math.max(0, s.start || 0);
      const end = start + Math.max(0.1, s.duration || 2);
      const inIdx = i + 1;
      const outL = i === activeSubs.length - 1 ? "[vout]" : `[vx${i}]`;
      fc += `[${inIdx}:v]scale=${W}:-1[s${i}];${prev}[s${i}]overlay=(W-w)/2:H-h-48:enable='between(t\,${start.toFixed(3)}\,${end.toFixed(3)})'${outL};`;
      prev = outL;
    }
    fc = fc.replace(/;$/, "");
    const subArgs = [...overlayInputs, "-filter_complex", fc, "-map", "[vout]"];
    if (hasAudio) subArgs.push("-map", "0:a", "-c:a", "copy");
    else subArgs.push("-an");
    subArgs.push("-c:v", "libvpx-vp9", "-b:v", "1.2M", "-y", finalName);
    await ffmpeg.exec(subArgs);
  } else {
    const data = await ffmpeg.readFile(avOut);
    await ffmpeg.writeFile(finalName, data);
  }

  onProgress?.(96, "打包下载…");
  const out = await ffmpeg.readFile(finalName);
  const blob = new Blob([out.buffer], { type: "video/webm" });
  onProgress?.(100, "完成");
  return blob;
}

export const CDN_DOCS = FFMPEG_CDN;
