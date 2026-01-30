const video = document.getElementById("masterVideo");

// ------------------------------
// Basic helpers
// ------------------------------
function safePlay() {
  video.play().catch(() => {});
}
function safePause() {
  video.pause();
}

// Wrap time into [0, duration)
function wrapTime(t) {
  const d = video.duration;
  if (!isFinite(d) || d <= 0) return 0;
  return ((t % d) + d) % d;
}

// Use fastSeek if available (Safari/Chrome sometimes better)
function seekNow(t) {
  if (!isFinite(video.duration) || video.duration <= 0) return;
  const wrapped = wrapTime(t);

  try {
    if (typeof video.fastSeek === "function") {
      video.fastSeek(wrapped);
    } else {
      video.currentTime = wrapped;
    }
  } catch (_) {}
}

// ------------------------------
// Hover pause on overlay links
// ------------------------------
let isDragging = false;

function bindHoverPause(selector = ".overlay a") {
  document.querySelectorAll(selector).forEach(link => {
    link.addEventListener("mouseenter", () => {
      stopInertia();
      safePause();
    });
    link.addEventListener("mouseleave", () => {
      if (!isDragging) safePlay();
    });

    link.addEventListener("focus", () => {
      stopInertia();
      safePause();
    });
    link.addEventListener("blur", () => {
      if (!isDragging) safePlay();
    });
  });
}

// ------------------------------
// Infinite autoplay loop fallback
// ------------------------------
video.addEventListener("ended", () => {
  seekNow(0);
  safePlay();
});

// ------------------------------
// Scrub + inertia (RAFed seek to prevent freezing)
// ------------------------------
const SCRUB_SECONDS_PER_PX = 0.02; // tweak feel
const VEL_SMOOTHING = 0.25;

const INERTIA_FRICTION = 4.5;
const INERTIA_STOP_VEL = 0.1;

let startX = 0;
let startY = 0;
let startTime = 0;

let lastMoveTime = 0;
let lastDeltaPx = 0;
let velPxPerS = 0;

let inertiaRaf = null;
let inertiaVelSecPerS = 0;

// RAF seek throttle (prevents decode stalls)
let seekRaf = null;
let desiredTime = null;

function requestSeek(t) {
  desiredTime = t;
  if (seekRaf) return;

  seekRaf = requestAnimationFrame(() => {
    seekRaf = null;
    if (desiredTime == null) return;
    seekNow(desiredTime);
    desiredTime = null;
  });
}

function stopInertia() {
  if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
  inertiaRaf = null;
  inertiaVelSecPerS = 0;
}

function bindScrubPointer() {
  const stage = document.getElementById("slideshow");
  stage.style.touchAction = "none";

  stage.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    if (e.target.closest("a, button, input, textarea, select, label")) return;

    // Ensure metadata is loading so duration exists ASAP
    if (!isFinite(video.duration) || video.duration <= 0) {
      // poster is already showing; trigger load/play attempt
      safePlay();
    }

    stopInertia();
    isDragging = true;

    startX = e.clientX;
    startY = e.clientY;
    startTime = video.currentTime || 0;

    lastMoveTime = performance.now();
    lastDeltaPx = 0;
    velPxPerS = 0;

    safePause();

    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("pointermove", (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const deltaPx = dx + dy;

    const targetTime = startTime + deltaPx * SCRUB_SECONDS_PER_PX;
    requestSeek(targetTime);

    const now = performance.now();
    const dtMs = Math.max(1, now - lastMoveTime);
    const dPx = deltaPx - lastDeltaPx;

    const instVel = (dPx / dtMs) * 1000; // px/s
    velPxPerS = velPxPerS + (instVel - velPxPerS) * VEL_SMOOTHING;

    lastMoveTime = now;
    lastDeltaPx = deltaPx;

    e.preventDefault();
  }, { passive: false });

  window.addEventListener("pointerup", () => endDrag());
  window.addEventListener("pointercancel", () => endDrag());

  function endDrag() {
    if (!isDragging) return;
    isDragging = false;

    inertiaVelSecPerS = velPxPerS * SCRUB_SECONDS_PER_PX;

    // If a seek is queued, flush it before inertia/play
    if (desiredTime != null) seekNow(desiredTime);
    desiredTime = null;

    if (Math.abs(inertiaVelSecPerS) > INERTIA_STOP_VEL) {
      startInertia();
    } else {
      safePlay();
    }
  }

  function startInertia() {
    let prev = performance.now();

    const step = (t) => {
      inertiaRaf = null;

      const dt = Math.max(0.001, (t - prev) / 1000);
      prev = t;

      requestSeek((video.currentTime || 0) + inertiaVelSecPerS * dt);

      const sign = Math.sign(inertiaVelSecPerS);
      const mag = Math.max(0, Math.abs(inertiaVelSecPerS) * (1 - INERTIA_FRICTION * dt));
      inertiaVelSecPerS = mag * sign;

      if (Math.abs(inertiaVelSecPerS) < INERTIA_STOP_VEL) {
        stopInertia();
        safePlay();
        return;
      }

      inertiaRaf = requestAnimationFrame(step);
    };

    inertiaRaf = requestAnimationFrame(step);
  }
}

// ------------------------------
// Tab switching: "continuous" playback illusion
// ------------------------------
// We cannot force all browsers to keep decoding video in background,
// but we can jump forward by elapsed time when returning.
let hiddenAt = null;
let wasPlayingBeforeHide = false;

function bindVisibilityContinuity() {
  const onHide = () => {
    hiddenAt = performance.now();
    wasPlayingBeforeHide = !video.paused && !video.ended;
  };

  const onShow = () => {
    if (hiddenAt == null) return;

    const elapsedSec = (performance.now() - hiddenAt) / 1000;
    hiddenAt = null;

    if (isFinite(video.duration) && video.duration > 0) {
      // Move playhead forward as if it had continued playing
      seekNow((video.currentTime || 0) + elapsedSec);
    }

    // If user expects autoplay, resume
    if (!isDragging && wasPlayingBeforeHide) safePlay();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
    if (document.visibilityState === "visible") onShow();
  });

  // Extra belt-and-braces for Safari
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  window.addEventListener("blur", onHide);
  window.addEventListener("focus", onShow);
}

// ------------------------------
// Init
// ------------------------------
window.addEventListener("load", () => {
  bindHoverPause();
  bindScrubPointer();
  bindVisibilityContinuity();

  // Start once a frame is available (poster shows until then)
  video.addEventListener("loadeddata", () => {
    safePlay();
  }, { once: true });

  // If autoplay is blocked for any reason, first interaction will start it
  window.addEventListener("pointerdown", () => safePlay(), { once: true });
});
