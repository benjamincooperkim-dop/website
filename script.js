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

let currentVideoEl = null;
let currentImgEl = null;

// Scrub feel
const SCRUB_MS_PER_PX = 25;
const SCRUB_IMAGE_MS = 1000;

// NEW: tab-hide bookkeeping (prevents "return to black")
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
let inertiaVel = 0; // scrub-ms/s
let hoverPaused = false;

// ------------------------------
// Prefetch tuning
// ------------------------------
const PREFETCH_AHEAD = 3;
const preloadedImages = new Set();
const preloadedVideoMeta = new Set();

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

  if (currentVideoEl) {
    if (isPaused) currentVideoEl.pause();
    else currentVideoEl.play().catch(() => {});
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

function clearStage() {
  slideshowEl.innerHTML = "";
  currentVideoEl = null;
  currentImgEl = null;
}

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

function showRealSegment(idx, opts = { keepPaused: false }) {
  if (!realSegments.length) return;

  idx = Math.max(0, Math.min(idx, realSegments.length - 1));
  currentIndex = idx;

  const seg = realSegments[idx];
  if (!seg) return;

  prefetchAhead(idx);

  if (seg.type === "image") {
    const existingIsImg = !!currentImgEl;
    if (!existingIsImg || !currentImgEl || currentImgEl.src !== new URL(seg.src, location.href).href) {
      clearStage();
      const img = document.createElement("img");
      img.src = seg.src;
      img.className = "slide";
      slideshowEl.appendChild(img);
      currentImgEl = img;
    }
    return;
  }

  if (seg.type === "video") {
    const existingIsVideo = !!currentVideoEl;
    const needsNewVideo =
      !existingIsVideo ||
      !currentVideoEl ||
      currentVideoEl.src !== new URL(seg.src, location.href).href;

    if (needsNewVideo) {
      clearStage();
      const video = document.createElement("video");
      video.src = seg.src;
      video.className = "slide";
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = "auto";
      slideshowEl.appendChild(video);
      currentVideoEl = video;

      // Safety net: advance when ended (works if event fires)
      video.addEventListener("ended", () => {
        if (!isPaused && !isDragging && !inertiaActive) {
          seekRealToMs(seg.endMs + 1, { autoStart: true });
        }
      });

      video.addEventListener("error", () => {
        console.warn("Error playing video:", seg.src);
        if (!isPaused && !isDragging && !inertiaActive) {
          seekRealToMs(seg.endMs + 1, { autoStart: true });
        }
      });
    }

    if (!opts.keepPaused && !isPaused) currentVideoEl.play().catch(() => {});
    else currentVideoEl.pause();
  }
}

function seekRealToMs(ms, { autoStart = false } = {}) {
  if (!realSegments.length) return;

  playheadRealMs = wrapMs(ms, totalRealMs);
  const idx = segmentIndexAt(playheadRealMs, realSegments, totalRealMs);
  const seg = realSegments[idx];

  if (idx !== currentIndex) showRealSegment(idx, { keepPaused: true });
  else if (!currentVideoEl && !currentImgEl) showRealSegment(idx, { keepPaused: true });

  const withinMs = playheadRealMs - seg.startMs;

  if (seg.type === "video" && currentVideoEl) {
    const targetSec = Math.max(0, withinMs / 1000);

    const applySeek = () => {
      try { currentVideoEl.currentTime = targetSec; } catch (_) {}
      if (!isPaused && autoStart) currentVideoEl.play().catch(() => {});
      else currentVideoEl.pause();
    };

    if (isFinite(currentVideoEl.duration) && currentVideoEl.duration > 0) applySeek();
    else {
      currentVideoEl.addEventListener("loadedmetadata", applySeek, { once: true });
      try { currentVideoEl.load(); } catch (_) {}
    }
  }

  if (autoStart) {
    setPaused(false);
    ensureRAF();
  }
}

function seekScrubToMs(scrubMs, { autoStart = false } = {}) {
  const realMs = scrubToRealMs(scrubMs);
  seekRealToMs(realMs, { autoStart });
}

// ------------------------------
// Playback tick (normal playback loops forever)
// ------------------------------
function tick(now) {
  rafId = null;
  const dt = now - lastTick;
  lastTick = now;

  // ✅ WATCHDOG 1: if DOM is empty for any reason, redraw current segment
  if (!slideshowEl.firstChild && realSegments.length) {
    showRealSegment(currentIndex, { keepPaused: true });
  }

  if (!isPaused && !isDragging && !inertiaActive && realSegments.length) {
    const seg = realSegments[currentIndex];

    if (seg.type === "image") {
      seekRealToMs(playheadRealMs + dt, { autoStart: false });
    } else if (seg.type === "video" && currentVideoEl) {
      // ✅ WATCHDOG 2: if video ended while tab was hidden, advance manually
      if (currentVideoEl.ended) {
        seekRealToMs(seg.endMs + 1, { autoStart: true });
      } else {
        const t = (currentVideoEl.currentTime || 0) * 1000;
        playheadRealMs = wrapMs(seg.startMs + t, totalRealMs);

        // If browser paused it during idle but we're meant to be playing, nudge it
        if (currentVideoEl.paused) {
          currentVideoEl.play().catch(() => {});
        }
      }
    }
  }

  if (!isPaused || isDragging || inertiaActive) ensureRAF();
}

// ------------------------------
// Hover pause on overlay hyperlinks (desktop)
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
// Inertia runner (scrub timeline, wraps forever, then resumes playback)
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
// Scrubber (mouse + touch) via Pointer Events
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
// Visibility fix (tab idle/hidden => avoid returning to black)
// ------------------------------
function bindVisibilityFix() {
  const onHide = () => {
    wasHidden = true;
    hiddenAt = Date.now();

    // Pause video to avoid browser leaving it in a half state
    if (currentVideoEl && !currentVideoEl.paused) {
      currentVideoEl.pause();
    }
  };

  const onShow = () => {
    ensureRAF();

    // If we were hidden, advance playhead by elapsed time so carousel "continued"
    if (wasHidden && hiddenAt != null) {
      const elapsed = Date.now() - hiddenAt;
      hiddenAt = null;
      wasHidden = false;

      seekRealToMs(playheadRealMs + elapsed, { autoStart: !isPaused });
      return;
    }

    // Ensure we aren't blank
    if (!slideshowEl.firstChild && realSegments.length) {
      showRealSegment(currentIndex, { keepPaused: true });
    }

    // Nudge video if needed
    const seg = realSegments[currentIndex];
    if (!isPaused && !isDragging && !inertiaActive && seg?.type === "video" && currentVideoEl) {
      if (currentVideoEl.ended) {
        seekRealToMs(seg.endMs + 1, { autoStart: true });
      } else {
        currentVideoEl.play().catch(() => {});
      }
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
    if (document.visibilityState === "visible") onShow();
  });

  // Safari/iOS helpers
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  window.addEventListener("blur", onHide);
  window.addEventListener("focus", onShow);
}

// ------------------------------
// Preload video durations (for accurate scrubbing)
// ------------------------------
function preloadVideoDurations() {
  const videoSlides = slides.filter(s => s.type === "video");
  if (!videoSlides.length) return Promise.resolve();

  const promises = videoSlides.map((s) => {
    return new Promise((resolve) => {
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
    });
  });

  return Promise.all(promises).then(() => {});
}

// ------------------------------
// Init
// ------------------------------
window.addEventListener("load", async () => {
  if (!slides.length) return;

  await preloadVideoDurations();
  buildSegments();

  showRealSegment(0, { keepPaused: true });
  seekRealToMs(0, { autoStart: true });
  prefetchAhead(0);

  bindHoverPause();
  bindScrubberPointer();
  bindVisibilityFix();
});
