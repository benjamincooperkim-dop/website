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
  video.play().catch(() => {});
}

function safePause() {
  try { video.pause(); } catch (_) {}
}

// Decide whether we should be playing right now
function syncPlayback() {
  const shouldPause = holdPaused || linkPaused;

  if (shouldPause) {
    safePause();
  } else {
    safePlay();
  }
}

// ------------------------------
// Force loop + watchdog (mobile stability)
// ------------------------------
function forceLoopAndPlay() {
  try { video.currentTime = 0; } catch (_) {}
  safePlay();
}

// Belt + braces: if loop attribute fails, force it.
video.addEventListener("ended", forceLoopAndPlay);

// Watchdog: if it stalls while "should be playing", nudge it.
let watchdogTimer = null;
let lastT = 0;

function startWatchdog() {
  stopWatchdog();
  lastT = video.currentTime || 0;

  watchdogTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (holdPaused || linkPaused) return;

    // If supposed to be playing but time isn't moving -> nudge play
    const t = video.currentTime || 0;
    const shouldBePlaying = !video.paused;

    if (shouldBePlaying) {
      const stuck = Math.abs(t - lastT) < 0.01;
      if (stuck) {
        safePlay();

        // If it's stuck near the end, force loop
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
      // Resume if we aren't intentionally paused
      syncPlayback();
    } else {
      // Pause in background (saves battery & avoids weird states)
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

  // Start ASAP once a frame is available; poster covers before then
  video.addEventListener("loadeddata", () => {
    syncPlayback();
    startWatchdog();
  }, { once: true });

  // If autoplay is blocked, first interaction starts it.
  window.addEventListener("pointerdown", () => safePlay(), { once: true });
});
