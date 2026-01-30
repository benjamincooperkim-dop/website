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

function wrapTime(t) {
  const d = video.duration;
  if (!isFinite(d) || d <= 0) return 0;
  return ((t % d) + d) % d;
}

function seekNow(t) {
  if (!isFinite(video.duration) || video.duration <= 0) return;
  const wrapped = wrapTime(t);

  try {
    if (typeof video.fastSeek === "function") video.fastSeek(wrapped);
    else video.currentTime = wrapped;
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
// Force loop (belt + braces)
// ------------------------------
function forceLoopAndPlay() {
  seekNow(0);
  safePlay();
}

video.addEventListener("ended", () => {
  // Some mobile browsers get weird with loop; force it.
  forceLoopAndPlay();
});

// ------------------------------
// Stall watchdog (fix "stops after a few loops" on mobile)
// ------------------------------
let watchdogTimer = null;
let lastT = 0;

function startWatchdog() {
  stopWatchdog();
  lastT = video.currentTime || 0;

  watchdogTimer = setInterval(() => {
    // If user is scrubbing or page hidden, don't interfere
    if (isDragging || document.visibilityState !== "visible") return;

    // If video should be playing but time isn't moving, nudge it
    const shouldBePlaying = !video.paused;
    const t = video.currentTime || 0;

    if (shouldBePlaying) {
      const stuck = Math.abs(t - lastT) < 0.01; // ~no movement
      if (stuck) {
        // Try a gentle nudge: play again
        safePlay();

        // If we're at the very end, force loop
        if (isFinite(video.duration) && video.duration > 0 && t >= video.duration - 0.05) {
          forceLoopAndPlay();
        }
      }
    }

    lastT = t;
  }, 1200);
}

function stopWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

// ------------------------------
// Scrub + inertia (wrap-around)
// ------------------------------
const SCRUB_SECONDS_PER_PX = 0.02;
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

// RAF throttled seek
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

    const instVel = (dPx / dtMs) * 1000;
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

    // flush any queued seek
    if (desiredTime != null) seekNow(desiredTime);
    desiredTime = null;

    if (Math.abs(inertiaVelSecPerS) > INERTIA_STOP_VEL) startInertia();
    else safePlay();
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
// Visibility continuity (resume on return)
// ------------------------------
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
      seekNow((video.currentTime || 0) + elapsedSec);
    }

    if (!isDragging && wasPlayingBeforeHide) safePlay();
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
// Init
// ------------------------------
window.addEventListener("load", () => {
  bindHoverPause();
  bindScrubPointer();
  bindVisibilityContinuity();

  video.addEventListener("loadeddata", () => {
    safePlay();
    startWatchdog();
  }, { once: true });

  // restart watchdog if the browser pauses unexpectedly
  video.addEventListener("play", () => startWatchdog());
  video.addEventListener("pause", () => {
    if (document.visibilityState === "visible" && !isDragging) startWatchdog();
  });

  // if autoplay is blocked, first interaction starts it
  window.addEventListener("pointerdown", () => safePlay(), { once: true });
});
