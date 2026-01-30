const video = document.getElementById("masterVideo");

// ------------------------------
// Hover pause on overlay links
// ------------------------------
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

function safePlay() {
  video.play().catch(() => {});
}

function safePause() {
  video.pause();
}

// ------------------------------
// Scrub + inertia
// ------------------------------
const SCRUB_SECONDS_PER_PX = 0.02; // bigger = faster scrub
const VEL_SMOOTHING = 0.25;

const INERTIA_FRICTION = 4.5; // bigger = stops sooner
const INERTIA_STOP_VEL = 0.1; // seconds/sec threshold

let isDragging = false;
let startX = 0;
let startY = 0;
let startTime = 0;

let lastMoveTime = 0;
let lastDeltaPx = 0;
let velPxPerS = 0;

let inertiaRaf = null;
let inertiaVelSecPerS = 0;

function stopInertia() {
  if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
  inertiaRaf = null;
  inertiaVelSecPerS = 0;
}

function seekClamped(t) {
  if (!isFinite(video.duration) || video.duration <= 0) return;
  const clamped = Math.max(0, Math.min(video.duration - 0.001, t));
  try { video.currentTime = clamped; } catch (_) {}
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

    seekClamped(startTime + deltaPx * SCRUB_SECONDS_PER_PX);

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

      seekClamped((video.currentTime || 0) + inertiaVelSecPerS * dt);

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
// Visibility handling (tab switching)
// ------------------------------
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (!isDragging) safePlay();
  } else {
    safePause();
  }
});

// ------------------------------
// Init
// ------------------------------
window.addEventListener("load", () => {
  bindHoverPause();
  bindScrubPointer();

  // start as soon as a frame is available (poster shows until then)
  video.addEventListener("loadeddata", () => {
    safePlay();
  }, { once: true });

  // if autoplay is blocked for any reason, user interaction will start it
  window.addEventListener("pointerdown", () => safePlay(), { once: true });
});
