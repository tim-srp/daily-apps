/**
 * 闪剪台 FlashCut — browser-native multi-track short video editor
 */
import { exportProject, abortExport } from "./export.js";

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);

const state = {
  media: new Map(), // id -> {id,name,kind,mime,url,duration,width,height,el?}
  video: [],        // clips on V1
  audio: [],        // clips on A1
  subtitle: [],     // cues on S1
  selected: null,   // {track, id}
  playhead: 0,
  playing: false,
  pxPerSec: 48,
  defaultTransition: "cut",
  raf: 0,
};

const canvas = $("stage");
const ctx = canvas.getContext("2d");
const hiddenVideos = new Map(); // mediaId -> HTMLVideoElement

function toast(msg, err = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("err", !!err);
  t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 2200);
}

function fmt(t) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}

function totalDuration() {
  let max = 0;
  for (const c of state.video) max = Math.max(max, c.start + c.duration);
  for (const c of state.audio) max = Math.max(max, c.start + c.duration);
  for (const c of state.subtitle) max = Math.max(max, c.start + c.duration);
  return Math.max(max, 0.1);
}

function updateEmpty() {
  const has = state.media.size > 0 || state.video.length || state.audio.length || state.subtitle.length;
  $("emptyState").classList.toggle("hidden", has);
  $("stageEmpty").classList.toggle("hide", state.video.length > 0);
  $("btnExport").disabled = state.video.length === 0;
}

/* ---------- Media import ---------- */
async function probeFile(file) {
  const url = URL.createObjectURL(file);
  const mime = file.type || "";
  let kind = "video";
  if (mime.startsWith("audio/")) kind = "audio";
  else if (mime.startsWith("image/")) kind = "image";
  else if (mime.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) kind = "video";
  else if (/\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name)) kind = "audio";
  else if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) kind = "image";

  const meta = { id: uid(), name: file.name, kind, mime, url, duration: 3, width: 0, height: 0, file };

  if (kind === "image") {
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { meta.width = img.naturalWidth; meta.height = img.naturalHeight; meta.duration = 3; res(); };
      img.onerror = rej;
      img.src = url;
    });
  } else {
    await new Promise((res) => {
      const el = document.createElement(kind === "audio" ? "audio" : "video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        meta.duration = Number.isFinite(el.duration) ? el.duration : 3;
        if (kind === "video") { meta.width = el.videoWidth; meta.height = el.videoHeight; }
        res();
      };
      el.onerror = () => res();
      el.src = url;
    });
  }
  return meta;
}

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  if (state.media.size + files.length > 6) {
    toast("素材较多可能卡顿，建议控制在 2–3 个短片段", true);
  }
  for (const f of files) {
    try {
      const m = await probeFile(f);
      state.media.set(m.id, m);
      if (m.kind === "video") {
        const v = document.createElement("video");
        v.preload = "auto";
        v.muted = true;
        v.playsInline = true;
        v.src = m.url;
        hiddenVideos.set(m.id, v);
      }
    } catch (e) {
      toast(`无法读取 ${f.name}`, true);
    }
  }
  renderLibrary();
  updateEmpty();
  toast(`已导入 ${files.length} 个素材`);
}

function renderLibrary() {
  const list = $("libList");
  list.innerHTML = "";
  $("libCount").textContent = String(state.media.size);
  for (const m of state.media.values()) {
    const el = document.createElement("div");
    el.className = "lib-item";
    el.draggable = true;
    el.dataset.id = m.id;
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (m.kind === "image") {
      const img = document.createElement("img");
      img.src = m.url; img.alt = "";
      thumb.appendChild(img);
    } else if (m.kind === "video") {
      const v = document.createElement("video");
      v.src = m.url; v.muted = true; v.playsInline = true;
      thumb.appendChild(v);
    } else {
      thumb.textContent = "♪";
    }
    const meta = document.createElement("div");
    meta.className = "lib-meta";
    meta.innerHTML = `<div class="name"></div><div class="sub"></div>`;
    meta.querySelector(".name").textContent = m.name;
    meta.querySelector(".sub").textContent =
      `${m.kind === "video" ? "视频" : m.kind === "audio" ? "音频" : "图片"} · ${fmt(m.duration)}`;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add";
    add.title = "添加到时间轴";
    add.textContent = "+";
    add.onclick = (e) => { e.stopPropagation(); addMediaToTimeline(m.id); };
    el.append(thumb, meta, add);
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/flashcut-media", m.id);
      e.dataTransfer.effectAllowed = "copy";
    });
    list.appendChild(el);
  }
}

function addMediaToTimeline(mediaId, trackHint) {
  const m = state.media.get(mediaId);
  if (!m) return;
  let track = trackHint;
  if (!track) {
    if (m.kind === "audio") track = "audio";
    else if (m.kind === "image" || m.kind === "video") track = "video";
    else track = "video";
  }
  if (track === "video" && m.kind === "audio") track = "audio";
  if (track === "audio" && m.kind === "image") track = "video";

  const arr = state[track];
  const start = arr.reduce((mx, c) => Math.max(mx, c.start + c.duration), 0);
  const dur = Math.min(m.duration, m.kind === "image" ? 3 : m.duration);
  const clip = {
    id: uid(),
    mediaId: m.id,
    start,
    duration: dur,
    inPoint: 0,
    outPoint: dur,
    transition: state.defaultTransition,
    volume: 1,
  };
  if (track === "video" && arr.length === 0) clip.transition = "cut";
  arr.push(clip);
  state.selected = { track, id: clip.id };
  renderTimeline();
  renderInspector();
  updateEmpty();
  drawFrame(state.playhead);
}

/* ---------- Timeline ---------- */
function renderTimeline() {
  const inner = $("tlInner");
  const dur = Math.max(totalDuration() + 2, 8);
  const width = Math.ceil(dur * state.pxPerSec);
  inner.style.width = (72 + width) + "px";

  // ruler
  const ruler = $("tlRuler");
  ruler.style.width = width + "px";
  ruler.innerHTML = "";
  const step = state.pxPerSec >= 64 ? 1 : state.pxPerSec >= 32 ? 2 : 5;
  for (let t = 0; t <= dur; t += step) {
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = (t * state.pxPerSec) + "px";
    tick.textContent = fmt(t).slice(0, 5);
    ruler.appendChild(tick);
  }

  paintLane("laneVideo", state.video, "video");
  paintLane("laneAudio", state.audio, "audio");
  paintLane("laneSub", state.subtitle, "subtitle");
  updatePlayhead();
  updateTimecode();
}

function paintLane(laneId, clips, kind) {
  const lane = $(laneId);
  lane.innerHTML = "";
  lane.style.width = Math.ceil((totalDuration() + 2) * state.pxPerSec) + "px";
  for (const c of clips) {
    const el = document.createElement("div");
    el.className = `clip ${kind}` + (state.selected?.id === c.id && state.selected?.track === kind ? " selected" : "");
    el.style.left = (c.start * state.pxPerSec) + "px";
    el.style.width = Math.max(8, c.duration * state.pxPerSec) + "px";
    const name = kind === "subtitle"
      ? (c.text || "字幕")
      : (state.media.get(c.mediaId)?.name || "片段");
    el.innerHTML = `<span class="clip-name"></span>`;
    el.querySelector(".clip-name").textContent =
      kind === "video" && c.transition === "crossfade" ? `✧ ${name}` : name;
    el.title = name;
    el.onclick = (e) => {
      e.stopPropagation();
      state.selected = { track: kind, id: c.id };
      renderTimeline();
      renderInspector();
    };
    // simple drag to reorder / move start
    el.onpointerdown = (ev) => beginClipDrag(ev, kind, c, el);
    lane.appendChild(el);
  }
  lane.onclick = (e) => {
    if (e.target === lane) {
      const rect = lane.getBoundingClientRect();
      const x = e.clientX - rect.left + lane.parentElement.scrollLeft;
      // lane itself doesn't scroll — tlScroll does
    }
  };
}

let drag = null;
function beginClipDrag(ev, track, clip, el) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const startX = ev.clientX;
  const origStart = clip.start;
  drag = { track, clip, startX, origStart };
  el.setPointerCapture?.(ev.pointerId);
  const move = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    let ns = Math.max(0, drag.origStart + dx / state.pxPerSec);
    // snap lightly
    ns = Math.round(ns * 10) / 10;
    clip.start = ns;
    el.style.left = (clip.start * state.pxPerSec) + "px";
    updatePlayhead();
  };
  const up = () => {
    drag = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    // re-sort by start for conceptual reorder
    state[track].sort((a, b) => a.start - b.start);
    renderTimeline();
    renderInspector();
    drawFrame(state.playhead);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function updatePlayhead() {
  const ph = $("playhead");
  ph.style.left = (72 + state.playhead * state.pxPerSec) + "px";
}

function updateTimecode() {
  $("timecode").textContent = `${fmt(state.playhead)} / ${fmt(totalDuration())}`;
}

function seekFromEvent(e) {
  const scroll = $("tlScroll");
  const inner = $("tlInner");
  const rect = inner.getBoundingClientRect();
  const x = e.clientX - rect.left - 72 + scroll.scrollLeft;
  const t = Math.max(0, Math.min(totalDuration(), x / state.pxPerSec));
  state.playhead = t;
  updatePlayhead();
  updateTimecode();
  drawFrame(t);
  syncMediaTime(t);
}

$("tlScroll").addEventListener("click", (e) => {
  if (e.target.closest(".clip")) return;
  seekFromEvent(e);
});

/* ---------- Inspector ---------- */
function selectedClip() {
  if (!state.selected) return null;
  const arr = state[state.selected.track];
  return arr?.find((c) => c.id === state.selected.id) || null;
}

function renderInspector() {
  const box = $("inspector");
  const clip = selectedClip();
  $("btnDelete").disabled = !clip;
  if (!clip) {
    box.innerHTML = `<p class="muted center">选中时间轴上的片段以编辑入出点、时长或字幕文案</p>`;
    return;
  }
  const track = state.selected.track;
  if (track === "subtitle") {
    box.innerHTML = `
      <div class="field"><label>字幕文案</label><textarea id="fText"></textarea></div>
      <div class="row2">
        <div class="field"><label>开始 (秒)</label><input id="fStart" type="number" min="0" step="0.1"></div>
        <div class="field"><label>时长 (秒)</label><input id="fDur" type="number" min="0.1" step="0.1"></div>
      </div>`;
    $("fText").value = clip.text || "";
    $("fStart").value = clip.start;
    $("fDur").value = clip.duration;
    const bind = () => {
      clip.text = $("fText").value;
      clip.start = Math.max(0, parseFloat($("fStart").value) || 0);
      clip.duration = Math.max(0.1, parseFloat($("fDur").value) || 1);
      renderTimeline();
      drawFrame(state.playhead);
    };
    ["fText", "fStart", "fDur"].forEach((id) => $(id).addEventListener("input", bind));
    return;
  }
  const media = state.media.get(clip.mediaId);
  const isImg = media?.kind === "image";
  box.innerHTML = `
    <div class="field"><label>素材</label><input disabled value=""></div>
    <div class="row2">
      <div class="field"><label>入点 (秒)</label><input id="fIn" type="number" min="0" step="0.1" ${isImg ? "disabled" : ""}></div>
      <div class="field"><label>出点 / 时长</label><input id="fDur" type="number" min="0.1" step="0.1"></div>
    </div>
    <div class="field"><label>时间轴起点</label><input id="fStart" type="number" min="0" step="0.1"></div>
    ${track === "video" ? `<div class="field"><label>转场（接到上一段）</label>
      <select id="fTrans"><option value="cut">硬切</option><option value="crossfade">交叉溶解</option></select>
    </div>` : ""}
    <p class="muted">拖拽片段可调整位置；修改入点/时长即完成裁剪。</p>`;
  box.querySelector("input").value = media?.name || "";
  $("fIn").value = clip.inPoint || 0;
  $("fDur").value = clip.duration;
  $("fStart").value = clip.start;
  if (track === "video") $("fTrans").value = clip.transition || "cut";
  const bind = () => {
    const mediaDur = media?.duration || 999;
    let inn = Math.max(0, parseFloat($("fIn").value) || 0);
    let dur = Math.max(0.1, parseFloat($("fDur").value) || 0.1);
    if (!isImg) {
      inn = Math.min(inn, Math.max(0, mediaDur - 0.1));
      dur = Math.min(dur, mediaDur - inn);
    }
    clip.inPoint = inn;
    clip.duration = dur;
    clip.outPoint = inn + dur;
    clip.start = Math.max(0, parseFloat($("fStart").value) || 0);
    if (track === "video") clip.transition = $("fTrans").value;
    renderTimeline();
    drawFrame(state.playhead);
  };
  ["fIn", "fDur", "fStart"].forEach((id) => $(id).addEventListener("input", bind));
  if (track === "video") $("fTrans").addEventListener("change", bind);
}

function deleteSelected() {
  const clip = selectedClip();
  if (!clip) return;
  const track = state.selected.track;
  state[track] = state[track].filter((c) => c.id !== clip.id);
  state.selected = null;
  renderTimeline();
  renderInspector();
  updateEmpty();
  drawFrame(state.playhead);
  toast("已删除");
}

function addSubtitle() {
  const start = state.playhead;
  const cue = { id: uid(), text: "双击编辑字幕", start, duration: 2 };
  state.subtitle.push(cue);
  state.subtitle.sort((a, b) => a.start - b.start);
  state.selected = { track: "subtitle", id: cue.id };
  renderTimeline();
  renderInspector();
  updateEmpty();
  drawFrame(state.playhead);
}

/* ---------- Preview ---------- */
function clipAtTime(clips, t) {
  // find topmost (last started that covers t); for transitions return pair
  let cur = null;
  let prev = null;
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (t >= c.start && t < c.start + c.duration) {
      cur = c;
      prev = i > 0 ? sorted[i - 1] : null;
      break;
    }
  }
  return { cur, prev, sorted };
}

function mediaTimeForClip(clip, timelineT) {
  return (clip.inPoint || 0) + (timelineT - clip.start);
}

function syncMediaTime(t) {
  const { cur } = clipAtTime(state.video, t);
  for (const [mid, v] of hiddenVideos) {
    if (cur && cur.mediaId === mid) {
      const mt = mediaTimeForClip(cur, t);
      if (Math.abs(v.currentTime - mt) > 0.12) {
        try { v.currentTime = mt; } catch (_) {}
      }
    }
  }
}

function drawCover(imgOrVideo, w, h) {
  const iw = imgOrVideo.videoWidth || imgOrVideo.naturalWidth || w;
  const ih = imgOrVideo.videoHeight || imgOrVideo.naturalHeight || h;
  if (!iw || !ih) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  const dx = (w - dw) / 2, dy = (h - dh) / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(imgOrVideo, dx, dy, dw, dh);
}

function drawFrame(t) {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const { cur, prev } = clipAtTime(state.video, t);
  if (cur) {
    const media = state.media.get(cur.mediaId);
    const fadeDur = 0.4;
    const intoClip = t - cur.start;
    const cross = cur.transition === "crossfade" && prev && intoClip < fadeDur;

    const drawMedia = (clip, alpha) => {
      const m = state.media.get(clip.mediaId);
      if (!m) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (m.kind === "image") {
        const img = new Image();
        // use cached? sync draw from object url may not be ready — use probe cache
        if (!m._img) {
          m._img = new Image();
          m._img.src = m.url;
        }
        if (m._img.complete) drawCover(m._img, w, h);
      } else {
        const v = hiddenVideos.get(m.id);
        if (v) {
          const mt = mediaTimeForClip(clip, t);
          if (Math.abs(v.currentTime - mt) > 0.15) {
            try { v.currentTime = Math.min(mt, (m.duration || mt) - 0.05); } catch (_) {}
          }
          if (v.readyState >= 2) drawCover(v, w, h);
        }
      }
      ctx.restore();
    };

    if (cross && prev) {
      const a = intoClip / fadeDur;
      drawMedia(prev, 1 - a);
      drawMedia(cur, a);
    } else {
      drawMedia(cur, 1);
    }
  }

  // subtitles overlay
  for (const s of state.subtitle) {
    if (t >= s.start && t < s.start + s.duration && (s.text || "").trim()) {
      drawSubtitle(s.text.trim(), w, h);
    }
  }
}

function drawSubtitle(text, w, h) {
  ctx.save();
  ctx.font = "bold 42px 'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const y = h - 100;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,.85)";
  ctx.fillStyle = "#fff";
  // wrap
  const maxW = w - 60;
  const chars = [...text];
  let line = "", lines = [];
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  lines = lines.slice(0, 3);
  lines.forEach((ln, i) => {
    const yy = y + (i - (lines.length - 1) / 2) * 48;
    ctx.strokeText(ln, w / 2, yy);
    ctx.fillText(ln, w / 2, yy);
  });
  ctx.restore();
}

/* ---------- Playback ---------- */
let lastTs = 0;
function tick(ts) {
  if (!state.playing) return;
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  state.playhead += dt;
  if (state.playhead >= totalDuration()) {
    state.playhead = totalDuration();
    pause();
  }
  updatePlayhead();
  updateTimecode();
  drawFrame(state.playhead);
  // audio track preview (simple)
  previewAudio(state.playhead);
  state.raf = requestAnimationFrame(tick);
}

const audioEls = new Map();
function previewAudio(t) {
  for (const clip of state.audio) {
    const m = state.media.get(clip.mediaId);
    if (!m) continue;
    let a = audioEls.get(clip.id);
    if (!a) {
      a = new Audio(m.url);
      audioEls.set(clip.id, a);
    }
    const active = t >= clip.start && t < clip.start + clip.duration;
    if (active && state.playing) {
      const mt = (clip.inPoint || 0) + (t - clip.start);
      if (a.paused) {
        try { a.currentTime = mt; a.play().catch(() => {}); } catch (_) {}
      }
    } else if (!a.paused) {
      a.pause();
    }
  }
  // also play video element audio? keep muted for canvas path; A track is BGM
  for (const [mid, v] of hiddenVideos) {
    const { cur } = clipAtTime(state.video, t);
    if (state.playing && cur && cur.mediaId === mid) {
      v.muted = state.audio.length > 0; // if BGM present, mute original; else unmute
      if (state.audio.length === 0) v.muted = false;
      if (v.paused) v.play().catch(() => {});
    } else if (!v.paused && (!cur || cur.mediaId !== mid)) {
      v.pause();
    }
  }
}

function play() {
  if (state.playhead >= totalDuration() - 0.05) state.playhead = 0;
  state.playing = true;
  lastTs = 0;
  $("btnPlay").textContent = "⏸";
  // kick videos
  syncMediaTime(state.playhead);
  for (const [mid, v] of hiddenVideos) {
    const { cur } = clipAtTime(state.video, state.playhead);
    if (cur && cur.mediaId === mid) v.play().catch(() => {});
  }
  state.raf = requestAnimationFrame(tick);
}

function pause() {
  state.playing = false;
  $("btnPlay").textContent = "▶";
  cancelAnimationFrame(state.raf);
  for (const v of hiddenVideos.values()) v.pause();
  for (const a of audioEls.values()) a.pause();
}

function togglePlay() {
  if (state.playing) pause();
  else play();
}

/* ---------- Export ---------- */
let exporting = false;
async function startExport() {
  if (exporting || !state.video.length) return;
  exporting = true;
  abortExport(); // reset flag
  $("exportModal").classList.remove("hidden");
  $("btnExDownload").classList.add("hidden");
  $("exBar").style.width = "0%";
  $("exPct").textContent = "0%";
  $("exStatus").textContent = "准备中…";
  try {
    const blob = await exportProject({
      mediaMap: state.media,
      videoClips: [...state.video].sort((a, b) => a.start - b.start),
      audioClips: [...state.audio].sort((a, b) => a.start - b.start),
      subtitles: [...state.subtitle],
      defaultTransition: state.defaultTransition,
    }, (pct, msg) => {
      $("exBar").style.width = pct + "%";
      $("exPct").textContent = Math.round(pct) + "%";
      $("exStatus").textContent = msg;
    });
    const url = URL.createObjectURL(blob);
    const a = $("btnExDownload");
    a.href = url;
    a.classList.remove("hidden");
    $("exStatus").textContent = "导出完成，点击下载";
    toast("导出完成");
  } catch (e) {
    console.error(e);
    $("exStatus").textContent = e.message || "导出失败";
    toast(e.message || "导出失败", true);
  } finally {
    exporting = false;
  }
}

/* ---------- Drop on lanes ---------- */
function wireLaneDrop(laneId, track) {
  const lane = $(laneId);
  lane.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  lane.addEventListener("drop", (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/flashcut-media");
    if (id) addMediaToTimeline(id, track);
  });
}

/* ---------- Wire UI ---------- */
function wire() {
  $("fileIn").addEventListener("change", (e) => { importFiles(e.target.files); e.target.value = ""; });
  $("fileIn2").addEventListener("change", (e) => { importFiles(e.target.files); e.target.value = ""; });
  $("btnPlay").onclick = togglePlay;
  $("btnToStart").onclick = () => { state.playhead = 0; updatePlayhead(); updateTimecode(); drawFrame(0); syncMediaTime(0); };
  $("btnDelete").onclick = deleteSelected;
  $("btnAddSub").onclick = addSubtitle;
  $("btnExport").onclick = startExport;
  $("btnExCancel").onclick = () => {
    abortExport();
    $("exportModal").classList.add("hidden");
  };
  $("transSelect").onchange = (e) => { state.defaultTransition = e.target.value; };
  $("zoomIn").onclick = () => { state.pxPerSec = Math.min(160, state.pxPerSec + 16); renderTimeline(); };
  $("zoomOut").onclick = () => { state.pxPerSec = Math.max(20, state.pxPerSec - 16); renderTimeline(); };

  wireLaneDrop("laneVideo", "video");
  wireLaneDrop("laneAudio", "audio");
  // subtitle lane: click to add at playhead already via button

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input,textarea,select")) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
  });

  // initial paint
  renderLibrary();
  renderTimeline();
  renderInspector();
  updateEmpty();
  drawFrame(0);
}

wire();
