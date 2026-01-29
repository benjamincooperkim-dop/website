// ------------------------------
// Slideshow config
// ------------------------------
const slides = [
  { type: "video", src: "media/Benjamin_Cooper_Kim_Saint_Laurent_01.mp4" },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Alexander_McQueen_01.jpg", duration: 3000 },
  { type: "video", src: "media/Benjamin_Cooper_Kim_Oakley_Tom_Knox_01.mp4" },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Palace_Skateboards_Moschino_01.jpg", duration: 3000 },
  { type: "video", src: "media/Benjamin_Cooper_Kim_Saint_Laurent_02.mp4" },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Phoebe_Philo_01.jpg", duration: 3000 },
  { type: "video", src: "media/Benjamin_Cooper_Kim_Roberto_Cavalli_Fragrance_01.mp4" },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Roberto_Cavalli_Fragrance_02.jpg", duration: 3000 },
  { type: "video", src: "media/Benjamin_Cooper_Kim_STAY_Sky_Tellie_01.mp4" },
  { type: "image", src: "media/Benjamin_Cooper_Kim_motionpictures.jpg", duration: 7000 },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Dinosaur.jpg", duration: 7000 },
  { type: "video", src: "media/Benjamin_Cooper_Kim_STAY_Sky_Tellie_02.mp4" },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Aries_01.jpg", duration: 3000 },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Alexander_McQueen_03.jpg", duration: 3000 },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Alexander_McQueen_02.jpg", duration: 3000 },
  { type: "image", src: "media/Benjamin_Cooper_Kim_Alexander_McQueen_04.jpg", duration: 3000 },
];

const slideshowEl = document.getElementById("slideshow");

// ------------------------------
// Timeline + state
// ------------------------------
let realSegments = [];
let scrubSegments = [];
let totalRealMs = 0;
let totalScrubMs = 0;

let currentIndex = 0;
let playheadRealMs = 0;

let isPaused = false;
let isDragging = false;

let rafId = null;
let lastTick = 0;

const SCRUB_MS_PER_PX = 25;
const SCRUB_IMAGE_MS = 1000;

// tab-hide bookkeeping
let hiddenAt = null;
let wasHidden = false;

// ------------------------------
// Inertia tuning
// ------------------------------
const INERTIA_FRICTION = 5.0;
const INERTIA_STOP_VEL = 40;
const INERTIA_MAX_VEL = 200000;
const VEL_SMOOTHING = 0.25;

let inertiaRafId = null;
let inertiaActive = false;
let inertiaVel = 0;
let hoverPaused = false;

// ------------------------------
// Prefetch tuning
// ------------------------------
const PREFETCH_AHEAD = 4;
const preloadedImages = new Set();
const preloadedVideoMeta = new Set();

// ------------------------------
// Swap layers (prevents black gaps)
// ------------------------------
let layerA, layerB, frontLayer, backLayer;
let renderToken = 0;

const FADE_MS = 80;

// NEW: pending seek/play instructions for newly swapped video
let pendingSeekSec = null;        // number | null
let pendingAutoPlay = false;      // whether to autoPlay after seek
let pendingSeekToken = 0;         // tie seek to latest seek request

// ------------------------------
// Helpers
// ------------------------------
function wrapMs(ms, total) {
  if (total <= 0) return 0;
  return ((ms % total) + total) % total;
}

function ensureRAF() {
  if (rafId) return;
  lastTick = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopInertia() {
  if (inertiaRafId) cancelAnimationFrame(inertiaRafId);
  inertiaRafId = null;
  inertiaActive = false;
  inertiaVel = 0;
}

function setPaused(nextPaused) {
  isPaused = nextPaused;

  const v = frontLayer?.querySelector("video");
  if (v) {
    if (isPaused) v.pause();
    else v.play().catch(() => {});
  }

  if (!isPaused) ensureRAF();
}

function buildSegments() {
  realSegments = [];
  scrubSegments = [];
  totalRealMs = 0;
  totalScrubMs = 0;

  slides.forEach((s, i) => {
    const realDurationMs = s.durationMs ?? s.duration ?? 5000;
    const scrubDurationMs = (s.type === "image") ? SCRUB_IMAGE_MS : realDurationMs;

    const realStartMs = totalRealMs;
    const realEndMs = realStartMs + realDurationMs;

    const scrubStartMs = totalScrubMs;
    const scrubEndMs = scrubStartMs + scrubDurationMs;

    realSegments.push({ ...s, durationMs: realDurationMs, startMs: realStartMs, endMs: realEndMs, index: i });
    scrubSegments.push({ ...s, durationMs: scrubDurationMs, startMs: scrubStartMs, endMs: scrubEndMs, index: i });

    totalRealMs = realEndMs;
    totalScrubMs = scrubEndMs;
  });
}

function segmentIndexAt(ms, segments, total) {
  if (!segments.length) return 0;
  ms = wrapMs(ms, total);
  for (let i = 0; i < segments.length; i++) {
    if (ms >= segments[i].startMs && ms < segments[i].endMs) return i;
  }
  return segments.length - 1;
}

function realToScrubMs(realMs) {
  realMs = wrapMs(realMs, totalRealMs);
  const idx = segmentIndexAt(realMs, realSegments, totalRealMs);
  const r = realSegments[idx];
  const s = scrubSegments[idx];
  const withinReal = realMs - r.startMs;
  const t = r.durationMs > 0 ? withinReal / r.durationMs : 0;
  return s.startMs + t * s.durationMs;
}

function scrubToRealMs(scrubMs) {
  scrubMs = wrapMs(scrubMs, totalScrubMs);
  const idx = segmentIndexAt(scrubMs, scrubSegments, totalScrubMs);
  const s = scrubSegments[idx];
  const r = realSegments[idx];
  const withinScrub = scrubMs - s.startMs;
  const t = s.durationMs > 0 ? withinScrub / s.durationMs : 0;
  return r.startMs + t * r.durationMs;
}

// ------------------------------
// Prefetching
// ------------------------------
function preloadImage(src) {
  if (preloadedImages.has(src)) return;
  preloadedImages.add(src);
  const img = new Image();
  img.src = src;
}

function preloadVideoMetadata(src) {
  if (preloadedVideoMeta.has(src)) return;
  preloadedVideoMeta.add(src);
  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  v.playsInline = true;
  v.src = src;
  try { v.load(); } catch (_) {}
}

function prefetchAhead(fromIndex) {
  for (let n = 1; n <= PREFETCH_AHEAD; n++) {
    const idx = (fromIndex + n) % slides.length;
    const s = slides[idx];
    if (!s) continue;
    if (s.type === "image") preloadImage(s.src);
    if (s.type === "video") preloadVideoMetadata(s.src);
  }
}

// ------------------------------
// Layer init + safe cleanup
// ------------------------------
function initLayers() {
  layerA = document.createElement("div");
  layerB = document.createElement("div");

  [layerA, layerB].forEach(l => {
    l.className = "sl-layer";
    l.style.position = "absolute";
    l.style.inset = "0";
    l.style.width = "100%";
    l.style.height = "100%";
    l.style.opacity = "0";
    l.style.transition = `opacity ${FADE_MS}ms linear`;
    l.style.willChange = "opacity";
  });

  slideshowEl.style.position = "absolute";
  slideshowEl.style.inset = "0";
  slideshowEl.style.overflow = "hidden";

  slideshowEl.replaceChildren(layerA, layerB);

  frontLayer = layerA;
  backLayer = layerB;

  frontLayer.style.opacity = "1";
  backLayer.style.opacity = "0";
}

function styleMedia(el) {
  el.className = "slide";
  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.objectFit = "cover";
  el.style.mixBlendMode = "normal";
}

function killVideo(videoEl) {
  if (!videoEl) return;
  try { videoEl.pause(); } catch (_) {}
  try { videoEl.removeAttribute("src"); } catch (_) {}
  try { videoEl.load(); } catch (_) {}
}

function clearLayer(layer) {
  const v = layer.querySelector("video");
  if (v) killVideo(v);
  layer.replaceChildren();
}

function swapLayers() {
  backLayer.style.opacity = "1";
  frontLayer.style.opacity = "0";

  const oldFront = frontLayer;
  frontLayer = backLayer;
  backLayer = oldFront;

  window.setTimeout(() => {
    clearLayer(backLayer);
  }, FADE_MS + 20);

  // After swapping, apply pending seek to NEW front video (if any)
  const v = frontLayer.querySelector("video");
  if (v && pendingSeekSec != null) {
    const myToken = pendingSeekToken;

    const applySeek = () => {
      // Ignore if a newer seek happened
      if (myToken !== pendingSeekToken) return;

      try { v.currentTime = Math.max(0, pendingSeekSec); } catch (_) {}

      if (!isPaused && pendingAutoPlay) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    };

    if (isFinite(v.duration) && v.duration > 0) applySeek();
    else v.addEventListener("loadedmetadata", applySeek, { once: true });

    // Clear once applied (but keep token)
    pendingSeekSec = null;
    pendingAutoPlay = false;
  }
}

function waitForPaintedVideoFrame(video) {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }
    const go = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
    if (video.readyState >= 2) go();
    else video.addEventListener("loadeddata", go, { once: true });
  });
}

// ------------------------------
// Render segment (no black gaps)
// ------------------------------
async function showRealSegment(idx, opts = { keepPaused: false }) {
  if (!realSegments.length) return;

  idx = Math.max(0, Math.min(idx, realSegments.length - 1));
  currentIndex = idx;

  const seg = realSegments[idx];
  if (!seg) return;

  prefetchAhead(idx);

  const token = ++renderToken;

  // If already showing same asset on front, don’t swap.
  const frontImg = frontLayer.querySelector("img");
  const frontVid = frontLayer.querySelector("video");
  const absSrc = new URL(seg.src, location.href).href;

  if (seg.type === "image" && frontImg && frontImg.src === absSrc) return;
  if (seg.type === "video" && frontVid && frontVid.src === absSrc) return;

  clearLayer(backLayer);

  if (seg.type === "image") {
    const img = document.createElement("img");
    img.src = seg.src;
    styleMedia(img);
    backLayer.appendChild(img);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    }).catch(() => console.warn("Image failed:", seg.src));

    if (token !== renderToken) return;

    if (img.decode) {
      try { await img.decode(); } catch (_) {}
      if (token !== renderToken) return;
    }

    swapLayers();
    return;
  }

  if (seg.type === "video") {
    const video = document.createElement("video");
    video.src = seg.src;
    video.muted = true;
    video.playsInline = true;
    video.loop = false;
    video.preload = "auto";
    styleMedia(video);
    backLayer.appendChild(video);

    try { video.load(); } catch (_) {}

    // Kick decode
    try { await video.play(); } catch (_) {}

    await waitForPaintedVideoFrame(video);
    if (token !== renderToken) return;

    // Keep paused if needed
    if (opts.keepPaused || isPaused) {
      try { video.pause(); } catch (_) {}
    }

    swapLayers();

    const v = frontLayer.querySelector("video");
    if (v) {
      if (!opts.keepPaused && !isPaused) v.play().catch(() => {});
      else v.pause();

      v.addEventListener("ended", () => {
        if (!isPaused && !isDragging && !inertiaActive) {
          seekRealToMs(seg.endMs + 1, { autoStart: true });
        }
      });

      v.addEventListener("error", () => {
        console.warn("Video error:", seg.src);
        if (!isPaused && !isDragging && !inertiaActive) {
          seekRealToMs(seg.endMs + 1, { autoStart: true });
        }
      });
    }
  }
}

// ------------------------------
// Seek (reliable)
// ------------------------------
function seekRealToMs(ms, { autoStart = false } = {}) {
  if (!realSegments.length) return;

  playheadRealMs = wrapMs(ms, totalRealMs);
  const idx = segmentIndexAt(playheadRealMs, realSegments, totalRealMs);
  const seg = realSegments[idx];

  const withinMs = playheadRealMs - seg.startMs;

  // If target is video, record pending seek for the NEXT video we swap in
  if (seg.type === "video") {
    pendingSeekToken++;
    pendingSeekSec = Math.max(0, withinMs / 1000);
    pendingAutoPlay = autoStart;
  } else {
    // not video: clear pending video seek
    pendingSeekSec = null;
    pendingAutoPlay = false;
    pendingSeekToken++;
  }

  // Render correct segment (async; old stays visible until ready)
  showRealSegment(idx, { keepPaused: true });

  // If we’re already on that video in the front, seek immediately too
  const v = frontLayer.querySelector("video");
  if (seg.type === "video" && v) {
    const absSrc = new URL(seg.src, location.href).href;
    if (v.src === absSrc) {
      try { v.currentTime = Math.max(0, withinMs / 1000); } catch (_) {}
      if (!isPaused && autoStart) v.play().catch(() => {});
      else v.pause();
      // We applied it, clear pending for this particular seek
      pendingSeekSec = null;
      pendingAutoPlay = false;
    }
  }

  if (autoStart) {
    setPaused(false);
    ensureRAF();
  }
}

function seekScrubToMs(scrubMs, { autoStart = false } = {}) {
  seekRealToMs(scrubToRealMs(scrubMs), { autoStart });
}

// ------------------------------
// Playback tick
// ------------------------------
function tick(now) {
  rafId = null;
  const dt = now - lastTick;
  lastTick = now;

  if (!frontLayer.firstChild && realSegments.length) {
    showRealSegment(currentIndex, { keepPaused: true });
  }

  if (!isPaused && !isDragging && !inertiaActive && realSegments.length) {
    const seg = realSegments[currentIndex];

    if (seg.type === "image") {
      seekRealToMs(playheadRealMs + dt, { autoStart: false });
    } else if (seg.type === "video") {
      const v = frontLayer.querySelector("video");
      if (v) {
        if (v.ended) {
          seekRealToMs(seg.endMs + 1, { autoStart: true });
        } else {
          const t = (v.currentTime || 0) * 1000;
          playheadRealMs = wrapMs(seg.startMs + t, totalRealMs);
          if (v.paused) v.play().catch(() => {});
        }
      }
    }
  }

  if (!isPaused || isDragging || inertiaActive) ensureRAF();
}

// ------------------------------
// Hover pause on overlay links
// ------------------------------
function bindHoverPause(selector = ".overlay a") {
  document.querySelectorAll(selector).forEach(link => {
    link.addEventListener("mouseenter", () => {
      hoverPaused = true;
      stopInertia();
      setPaused(true);
    });
    link.addEventListener("mouseleave", () => {
      hoverPaused = false;
      if (!isDragging) setPaused(false);
    });
    link.addEventListener("focus", () => {
      hoverPaused = true;
      stopInertia();
      setPaused(true);
    });
    link.addEventListener("blur", () => {
      hoverPaused = false;
      if (!isDragging) setPaused(false);
    });
  });
}

// ------------------------------
// Inertia runner
// ------------------------------
function startInertia(initialVelScrubMsPerS) {
  stopInertia();
  inertiaActive = true;
  inertiaVel = Math.max(-INERTIA_MAX_VEL, Math.min(initialVelScrubMsPerS, INERTIA_MAX_VEL));

  setPaused(true);

  let prev = performance.now();
  let scrubPos = realToScrubMs(playheadRealMs);

  const step = (t) => {
    inertiaRafId = null;

    if (!inertiaActive || isDragging || hoverPaused) {
      stopInertia();
      return;
    }

    const dt = Math.max(0.001, (t - prev) / 1000);
    prev = t;

    scrubPos = wrapMs(scrubPos + inertiaVel * dt, totalScrubMs);
    seekScrubToMs(scrubPos, { autoStart: false });

    const sign = Math.sign(inertiaVel);
    const decel = INERTIA_FRICTION * dt;
    const mag = Math.max(0, Math.abs(inertiaVel) * (1 - decel));
    inertiaVel = mag * sign;

    if (Math.abs(inertiaVel) < INERTIA_STOP_VEL) {
      stopInertia();
      if (!hoverPaused) setPaused(false);
      return;
    }

    inertiaRafId = requestAnimationFrame(step);
  };

  inertiaRafId = requestAnimationFrame(step);
}

// ------------------------------
// Scrubber (mouse + touch)
// ------------------------------
function shouldIgnoreScrubStart(target) {
  return !!target.closest("a, button, input, textarea, select, label");
}

function bindScrubberPointer() {
  slideshowEl.style.touchAction = "none";

  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  let startScrubMs = 0;

  let lastMoveTime = 0;
  let lastDeltaPx = 0;
  let velPxPerS = 0;

  const onDown = (e) => {
    if (!e.isPrimary) return;
    if (shouldIgnoreScrubStart(e.target)) return;

    activePointerId = e.pointerId;

    stopInertia();
    isDragging = true;
    setPaused(true);

    startX = e.clientX;
    startY = e.clientY;
    startScrubMs = realToScrubMs(playheadRealMs);

    lastMoveTime = performance.now();
    lastDeltaPx = 0;
    velPxPerS = 0;

    slideshowEl.setPointerCapture(activePointerId);
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!isDragging) return;
    if (activePointerId !== e.pointerId) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const deltaPx = dx + dy;

    const scrubMs = startScrubMs + (deltaPx * SCRUB_MS_PER_PX);
    seekScrubToMs(scrubMs, { autoStart: false });

    const now = performance.now();
    const dtMs = Math.max(1, now - lastMoveTime);
    const dPx = deltaPx - lastDeltaPx;

    const instVelPxPerS = (dPx / dtMs) * 1000;
    velPxPerS = velPxPerS + (instVelPxPerS - velPxPerS) * VEL_SMOOTHING;

    lastMoveTime = now;
    lastDeltaPx = deltaPx;

    e.preventDefault();
  };

  const endDrag = () => {
    if (!isDragging) return;
    isDragging = false;

    try {
      if (activePointerId !== null) slideshowEl.releasePointerCapture(activePointerId);
    } catch (_) {}

    activePointerId = null;

    const velScrubMsPerS = velPxPerS * SCRUB_MS_PER_PX;

    if (!hoverPaused && Math.abs(velScrubMsPerS) > INERTIA_STOP_VEL * 2) {
      startInertia(velScrubMsPerS);
    } else {
      if (!hoverPaused) setPaused(false);
    }
  };

  slideshowEl.addEventListener("pointerdown", onDown, { passive: false });
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
}

// ------------------------------
// Visibility fix
// ------------------------------
function bindVisibilityFix() {
  const onHide = () => {
    wasHidden = true;
    hiddenAt = Date.now();
    const v = frontLayer.querySelector("video");
    if (v && !v.paused) v.pause();
  };

  const onShow = () => {
    ensureRAF();
    if (wasHidden && hiddenAt != null) {
      const elapsed = Date.now() - hiddenAt;
      hiddenAt = null;
      wasHidden = false;
      seekRealToMs(playheadRealMs + elapsed, { autoStart: !isPaused });
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
    if (document.visibilityState === "visible") onShow();
  });

  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  window.addEventListener("blur", onHide);
  window.addEventListener("focus", onShow);
}

// ------------------------------
// Preload video durations
// ------------------------------
function preloadVideoDurations() {
  const videoSlides = slides.filter(s => s.type === "video");
  if (!videoSlides.length) return Promise.resolve();

  const promises = videoSlides.map((s) => new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.src = s.src;

    const done = () => {
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      s.durationMs = Math.max(1, Math.round(d * 1000));
      resolve();
    };

    v.addEventListener("loadedmetadata", done, { once: true });
    v.addEventListener("error", () => {
      s.durationMs = s.durationMs ?? 5000;
      resolve();
    }, { once: true });

    try { v.load(); } catch (_) {}
  }));

  return Promise.all(promises).then(() => {});
}

// ------------------------------
// Init
// ------------------------------
window.addEventListener("load", async () => {
  if (!slides.length) return;

  initLayers();

  // Preload images immediately (helps initial scrub)
  slides.forEach(s => { if (s.type === "image") preloadImage(s.src); });

  await preloadVideoDurations();
  buildSegments();

  showRealSegment(0, { keepPaused: true });
  seekRealToMs(0, { autoStart: true });
  prefetchAhead(0);

  bindHoverPause();
  bindScrubberPointer();
  bindVisibilityFix();
});
