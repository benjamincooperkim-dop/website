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
// Manual loop + recovery (mobile stability)
// ------------------------------
function softLoop() {
  // Some browsers can stall exactly at duration; rewinding to 0 is more reliable than trusting native loop.
  try { video.currentTime = 0; } catch (_) {}
  safePlay();
}

// Belt + braces: if loop attribute fails, force it.
video.addEventListener("ended", softLoop);

// Catch "near end" cases where 'ended' doesn't fire (seen on iOS occasionally)
video.addEventListener("timeupdate", () => {
  if (holdPaused || linkPaused) return;
  if (!isFinite(video.duration) || video.duration <= 0) return;
  if (video.currentTime >= video.duration - 0.05) softLoop();
});

function recoverVideo() {
  // Don't fight intentional pauses
  if (holdPaused || linkPaused) return;

  // Step 1: quick decode nudge (seek back a hair + play)
  try { video.pause(); } catch (_) {}

  try {
    const t = Math.max(0, (video.currentTime || 0) - 0.05);
    video.currentTime = t;
  } catch (_) {}

  safePlay();

  // Step 2 (escalation): if still stuck, reload element (strong Safari reset)
  setTimeout(() => {
    if (holdPaused || linkPaused) return;
    if (video.paused) return;

    const t1 = video.currentTime || 0;
    setTimeout(() => {
      const t2 = video.currentTime || 0;
      const stuck = Math.abs(t2 - t1) < 0.01;

      if (stuck) {
        try {
          video.pause();
          // Keep currentTime reset tiny to avoid re-seeking to a bad timestamp.
          video.currentTime = 0;
          video.load();
        } catch (_) {}

        safePlay();
      }
    }, 450);
  }, 250);
}

// Trigger recovery on common stall/error events
["stalled", "waiting", "error"].forEach(evt => {
  video.addEventListener(evt, () => recoverVideo());
});

// On iOS/Safari, coming back from bfcache can leave video visually frozen
window.addEventListener("pageshow", () => {
  syncPlayback();
});

// ------------------------------
// Watchdog: if it stalls while "should be playing", recover it.
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
          recoverVideo();
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
      }
    }

    lastT = t;
  }, 800);
}

function stopWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}

// ------------------------------
// Frame-advance monitor (best signal when supported)
// ------------------------------
let lastMediaTime = -1;
let stuckFrames = 0;

function startFrameMonitor() {
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) return;

  const onFrame = (_now, metadata) => {
    if (document.visibilityState === "visible" && !holdPaused && !linkPaused && !video.paused && !video.ended) {
      if (metadata.mediaTime === lastMediaTime) {
        stuckFrames++;
      } else {
        stuckFrames = 0;
        lastMediaTime = metadata.mediaTime;
      }

      // ~12 frames with no advance -> recover
      if (stuckFrames > 12) {
        stuckFrames = 0;
        recoverVideo();
      }
    } else {
      // reset counters when we shouldn't be playing
      stuckFrames = 0;
      lastMediaTime = metadata.mediaTime;
    }

    video.requestVideoFrameCallback(onFrame);
  };

  video.requestVideoFrameCallback(onFrame);
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
      // Safari sometimes needs a kick after tab/app switch
      safePlay();
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
    startFrameMonitor();
  }, { once: true });

  // If autoplay is blocked, first interaction starts it.
  window.addEventListener("pointerdown", () => safePlay(), { once: true });
});
