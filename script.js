const video = document.getElementById("masterVideo");
const stage = document.getElementById("slideshow");

// State
let holdPaused = false;     // user is holding (mouse/touch)
let linkPaused = false;     // hovering/focusing a link
let wasPlayingBeforeHold = true;

// ------------------------------
// Playback helpers
// ------------------------------
function safePlay() {
  // If the browser blocks autoplay, this will reject; we ignore and rely on user interaction.
  video.play().catch(() => {});
}

function safePause() {
  try { video.pause(); } catch (_) {}
}

// Decide whether we should be playing right now
function syncPlayback() {
  const shouldPause = holdPaused || linkPaused;
  if (shouldPause) safePause();
  else safePlay();
}

// ------------------------------
// Loop + recovery (mobile stability)
// ------------------------------

// Manual loop guard: some browsers (notably iOS Safari) can occasionally stall at loop boundaries.
function softLoop() {
  if (holdPaused || linkPaused) return;
  try { video.currentTime = 0; } catch (_) {}
  safePlay();
}

video.addEventListener("ended", softLoop);

// Catch "near end" cases where ended doesn't fire.
video.addEventListener("timeupdate", () => {
  if (holdPaused || linkPaused) return;
  if (!isFinite(video.duration) || video.duration <= 0) return;

  // If we get extremely close to the end, force the loop.
  if (video.currentTime >= video.duration - 0.05) {
    softLoop();
  }
});

// Recovery is throttled so we don't accidentally create a black-screen loop by over-resetting.
let lastRecoverAt = 0;
function recoverVideo(reason = "") {
  if (holdPaused || linkPaused) return;

  const now = Date.now();
  if (now - lastRecoverAt < 2500) return; // throttle
  lastRecoverAt = now;

  // Only attempt recovery once we have something loaded.
  // readyState >= 2 means we have current frame data.
  if (video.readyState < 2) {
    // Try play anyway; once data arrives it should start.
    safePlay();
    return;
  }

  // 1) Gentle nudge: pause -> small seek back -> play
  try { video.pause(); } catch (_) {}

  try {
    const t = Math.max(0, (video.currentTime || 0) - 0.08);
    video.currentTime = t;
  } catch (_) {}

  safePlay();

  // 2) If we're stuck at (or beyond) the end, loop.
  if (isFinite(video.duration) && video.duration > 0) {
    if ((video.currentTime || 0) >= video.duration - 0.05) softLoop();
  }
}

// Trigger recovery on common stall/error events (these fire a lot on mobile networks).
["stalled", "waiting", "error"].forEach(evt => {
  video.addEventListener(evt, () => recoverVideo(evt));
});

// On iOS/Safari, coming back from BFCache can leave video visually frozen.
window.addEventListener("pageshow", () => {
  // Kick it once; throttling prevents repeats.
  recoverVideo("pageshow");
  syncPlayback();
});

// ------------------------------
// Watchdog: if it stalls while "should be playing", nudge it.
// ------------------------------
let watchdogTimer = null;
let lastT = 0;
let stuckCount = 0;

function startWatchdog() {
  stopWatchdog();
  lastT = video.currentTime || 0;
  stuckCount = 0;

  watchdogTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (holdPaused || linkPaused) return;

    const t = video.currentTime || 0;
    const shouldBePlaying = !video.paused && !video.ended;

    if (shouldBePlaying) {
      const stuck = Math.abs(t - lastT) < 0.01;

      if (stuck) {
        stuckCount++;
        // Gentle nudge first
        safePlay();

        // If it's stuck near the end, force loop
        if (isFinite(video.duration) && video.duration > 0 && t >= video.duration - 0.05) {
          softLoop();
          stuckCount = 0;
        }

        // Escalate after a few consecutive stuck checks
        if (stuckCount >= 3) {
          recoverVideo("watchdog");
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
      }
    }

    lastT = t;
  }, 900);
}

function stopWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

// ------------------------------
// Pause on hover/focus links (like before)
// ------------------------------
function bindLinkPause(selector = ".overlay a") {
  document.querySelectorAll(selector).forEach(link => {
    link.addEventListener("mouseenter", () => {
      linkPaused = true;
      syncPlayback();
    });
    link.addEventListener("mouseleave", () => {
      linkPaused = false;
      syncPlayback();
    });

    link.addEventListener("focus", () => {
      linkPaused = true;
      syncPlayback();
    });
    link.addEventListener("blur", () => {
      linkPaused = false;
      syncPlayback();
    });
  });
}

// ------------------------------
// Hold-to-pause anywhere (mouse + touch via Pointer Events)
// ------------------------------
function bindHoldToPause() {
  // Make sure iOS doesn’t treat this as scroll/zoom gesture on the stage
  stage.style.touchAction = "none";

  stage.addEventListener("pointerdown", (e) => {
    // Don't interfere with clicking links
    if (e.target.closest("a, button, input, textarea, select, label")) return;

    wasPlayingBeforeHold = !video.paused;
    holdPaused = true;
    syncPlayback();

    // Capture pointer so we reliably get pointerup even if finger moves
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }, { passive: false });

  const release = (e) => {
    if (!holdPaused) return;

    holdPaused = false;
    // Only resume if it was playing before hold, and no link hover pause
    if (wasPlayingBeforeHold && !linkPaused) safePlay();
    else syncPlayback();

    try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);

  // Safety: if the pointer ends outside the stage
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}

// ------------------------------
// Visibility: resume cleanly when returning
// ------------------------------
function bindVisibilityHandling() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncPlayback();
      // Light kick on return (throttled)
      recoverVideo("visibility");
    } else {
      safePause();
    }
  });
}

// ------------------------------
// Init
// ------------------------------
window.addEventListener("load", () => {
  bindLinkPause();
  bindHoldToPause();
  bindVisibilityHandling();

  // Start ASAP once a frame is available
  video.addEventListener("loadeddata", () => {
    syncPlayback();
    startWatchdog();
  }, { once: true });

  // If autoplay is blocked, first interaction starts it.
  window.addEventListener("pointerdown", () => safePlay(), { once: true });
});
