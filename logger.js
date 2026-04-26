// logger.js
// Observes user behaviour and sends timestamped events to background.js.
//
// Events logged:
//   mode_change         — Full / Para / Sent / Study button clicks
//   phase_change        — skim ↔ thorough transitions via pill button
//   settings_change     — font size / line height / theme
//   pause_start         — scroll stall > 5s (includes scroll %, para index)
//   pause_end           — scroll resumes (includes duration ms)
//   selfcheck_answer    — check-in card submitted on Study exit
//   reading_notes       — notes saved from the notes panel
//   session_end         — overlay closed

(function () {

  function send(event, data = {}) {
    try {
      chrome.runtime.sendMessage({ type: "LOG_EVENT", event, data })
        .catch(() => {});
    } catch (_) {}
  }

  const host   = document.getElementById("adhd-reader-root");
  const shadow = host?.shadowRoot;
  if (!host || !shadow) {
    console.warn("[Liminal Reader] logger.js: no host found.");
    return;
  }

  // ── Mode change logging ──────────────────────────────────────────────
  ["mode-full", "mode-para", "mode-sentence", "mode-study"].forEach(id => {
    const btn = shadow.getElementById(id);
    if (!btn) return;
    btn.addEventListener("click", () => {
      send("mode_change", { mode: id.replace("mode-", "") });
    });
  });

  // ── Phase change logging (skim pill button) ──────────────────────────
  // Uses MutationObserver so it picks up the pill even if phases.js
  // inserts it after logger.js runs.
  function attachPhasePillLogger() {
    const pillBtn = shadow.getElementById("phase-pill-btn");
    if (!pillBtn) return false;
    pillBtn.addEventListener("click", () => {
      setTimeout(() => {
        const label = shadow.getElementById("phase-pill-label")?.textContent;
        send("phase_change", { phase: label });
      }, 10);
    });
    return true;
  }

  if (!attachPhasePillLogger()) {
    // Pill not yet in DOM — wait for it
    const pillObserver = new MutationObserver(() => {
      if (attachPhasePillLogger()) pillObserver.disconnect();
    });
    pillObserver.observe(shadow, { childList: true, subtree: true });
  }

  // ── Settings change logging ──────────────────────────────────────────
  const fontSlider = shadow.getElementById("font-size-slider");
  const lineSlider = shadow.getElementById("line-height-slider");
  if (fontSlider) fontSlider.addEventListener("change", () => {
    send("settings_change", { setting: "fontSize", value: fontSlider.value });
  });
  if (lineSlider) lineSlider.addEventListener("change", () => {
    send("settings_change", { setting: "lineHeight", value: lineSlider.value });
  });
  ["theme-warm","theme-white","theme-green","theme-dark"].forEach(id => {
    const btn = shadow.getElementById(id);
    if (btn) btn.addEventListener("click", () => {
      send("settings_change", { setting: "theme", value: id.replace("theme-", "") });
    });
  });

  // ── Scroll + pause + progress tracking ──────────────────────────────
  // Works across all three modes:
  //   Full mode:  scroll events drive pause detection
  //   Para/Sent:  dwell time between button clicks drives pause detection
  const overlay = shadow.getElementById("reader-overlay");
  let pauseTimer    = null;
  let pauseStart    = null;
  let isPaused      = false;
  let scrollSamples = [];
  let currentMode   = "full"; // tracked so we know which logic to apply
  let dwellStart    = null;   // when the user landed on current para/sentence
  let dwellPosition = null;   // { paraIndex, sentenceIndex } for para/sent modes

  // Track mode changes so pause logic knows which mode we're in
  ["mode-full", "mode-para", "mode-sentence"].forEach(id => {
    const btn = shadow.getElementById(id);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const newMode = id.replace("mode-", "");
      if (newMode !== currentMode) {
        cancelPause();
        currentMode = newMode;
        if (newMode !== "full") startDwellTracking();
      }
    });
  });

  function cancelPause() {
    clearTimeout(pauseTimer);
    if (isPaused) {
      send("pause_end", { durationMs: Date.now() - pauseStart, ...currentPosition() });
      isPaused = false;
      pauseStart = null;
    }
  }

  function currentPosition() {
    if (currentMode === "full") {
      return { scrollProgress: getScrollProgress(), paragraphIndex: getVisibleParagraphIndex() };
    }
    return { paragraphIndex: dwellPosition?.paraIndex ?? null, sentenceIndex: dwellPosition?.sentenceIndex ?? null };
  }

  function startDwellTracking(position) {
    dwellStart    = Date.now();
    dwellPosition = position || readCurrentNavPosition();
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      isPaused   = true;
      pauseStart = Date.now();
      send("pause_start", currentPosition());
    }, 5000);
  }

  function readCurrentNavPosition() {
    // Read current position from modes.js state exposed on __readerState
    const state = window.__readerState;
    return {
      paraIndex:     state?.__currentParaIndex     ?? null,
      sentenceIndex: state?.__currentSentenceIndex ?? null,
    };
  }

  // Attach dwell tracking to nav buttons — use MutationObserver since
  // mode-ui is rebuilt on every Next/Back click
  const navObserver = new MutationObserver(() => {
    const prevBtn = shadow.getElementById("mode-prev");
    const nextBtn = shadow.getElementById("mode-next");
    [prevBtn, nextBtn].forEach(btn => {
      if (!btn || btn.__loggerAttached) return;
      btn.__loggerAttached = true;
      btn.addEventListener("click", () => {
        // End any active pause, log dwell time, start fresh tracking
        const dwellMs = dwellStart ? Date.now() - dwellStart : null;
        if (isPaused) {
          send("pause_end", { durationMs: Date.now() - pauseStart, ...currentPosition() });
          isPaused = false; pauseStart = null;
        }
        if (dwellMs !== null) {
          send("nav_advance", { dwellMs, ...currentPosition() });
        }
        clearTimeout(pauseTimer);
        // Small delay to let modes.js update state before we read it
        setTimeout(() => startDwellTracking(), 50);
      });
    });
  });

  const contentEl = shadow.getElementById("reader-content");
  if (contentEl) navObserver.observe(contentEl, { childList: true, subtree: true });

  function getScrollProgress() {
    if (!overlay) return 0;
    const max = overlay.scrollHeight - overlay.clientHeight;
    if (max <= 0) return 100;
    return Math.round((overlay.scrollTop / max) * 100);
  }

  function getVisibleParagraphIndex() {
    const paras = shadow.querySelectorAll(".article-paragraph");
    if (!paras.length) return 0;
    // Find the paragraph whose center is closest to 40% viewport height
    // (approximate eye position when reading naturally)
    const targetY = window.innerHeight * 0.4;
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < paras.length; i++) {
      const rect = paras[i].getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue; // off screen
      const centerY = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(centerY - targetY);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    return bestIdx;
  }

  function estimateWpm() {
    if (scrollSamples.length < 2) return null;
    const first = scrollSamples[0];
    const last  = scrollSamples[scrollSamples.length - 1];
    const elapsedMin = (last.ts - first.ts) / 60000;
    if (elapsedMin < 0.1) return null;
    const paras = shadow.querySelectorAll(".article-paragraph");
    let totalWords = 0;
    paras.forEach(p => { totalWords += p.textContent.trim().split(/\s+/).length; });
    const scrollFraction = Math.min(1, (last.scrollTop - first.scrollTop) /
      Math.max(1, overlay.scrollHeight - overlay.clientHeight));
    return Math.round((totalWords * scrollFraction) / elapsedMin);
  }

  if (overlay) {
    overlay.addEventListener("scroll", () => {
      if (currentMode !== "full") return; // only Full mode uses scroll
      const now = Date.now();
      scrollSamples.push({ ts: now, scrollTop: overlay.scrollTop });
      if (scrollSamples.length > 100) scrollSamples.shift();

      if (isPaused) {
        const durationMs = now - pauseStart;
        send("pause_end", {
          durationMs,
          scrollProgress: getScrollProgress(),
          paragraphIndex: getVisibleParagraphIndex(),
        });
        isPaused   = false;
        pauseStart = null;
      }
      clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => {
        isPaused   = true;
        pauseStart = Date.now();
        send("pause_start", {
          scrollProgress: getScrollProgress(),
          paragraphIndex: getVisibleParagraphIndex(),
        });
      }, 5000);
    }, { passive: true });
  }

  // ── Session end ──────────────────────────────────────────────────────
  const closeBtn = shadow.getElementById("reader-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      send("session_end");
      clearTimeout(pauseTimer);
    });
  }

  // ── Export notes button (appended to settings panel) ─────────────────
  const settingsPanel = shadow.getElementById("settings-panel");
  if (settingsPanel) {
    const exportRow = document.createElement("div");
    exportRow.className = "setting-row";
    exportRow.style.cssText = "border-top:1px solid #e0dbd3; padding-top:10px; margin-top:4px;";
    exportRow.innerHTML = `
      <button id="export-notes-btn" style="
        padding:5px 14px; font-size:13px; border:1px solid #b8d4a0;
        border-radius:6px; background:#f4faf0; cursor:pointer; color:#5a7a3a; font-family:inherit;
      ">⬇ Export my notes</button>
      <span id="export-status" style="font-size:12px; color:#888;"></span>
    `;
    settingsPanel.appendChild(exportRow);

    shadow.getElementById("export-notes-btn").addEventListener("click", () => {
      const status = shadow.getElementById("export-status");
      chrome.runtime.sendMessage({ type: "EXPORT_LOG" }, response => {
        if (!response?.log) { status.textContent = "No log found."; return; }
        const log     = response.log;
        const answers = log.selfCheckAnswers || [];

        if (answers.length === 0) {
          status.textContent = "No notes recorded yet.";
          setTimeout(() => { status.textContent = ""; }, 3000);
          return;
        }

        const date     = new Date(log.startTime).toLocaleString();
        const duration = log.totalDuration
          ? `${(log.totalDuration / 60000).toFixed(1)} min` : "unknown";

        let text  = `READING NOTES\n`;
        text     += `${"=".repeat(40)}\n`;
        text     += `Article: ${log.title || "Untitled"}\n`;
        text     += `Date:     ${date}\n`;
        text     += `Duration: ${duration}\n`;
        text     += `${"=".repeat(40)}\n\n`;

        answers.forEach((item, i) => {
          const thumb = item.thumb === "up"   ? "👍 Clear"
                      : item.thumb === "down" ? "👎 Unclear"
                      : "not rated";
          text += `Check-in ${i + 1}\n`;
          text += `Q: ${item.question || ""}\n`;
          text += `Clarity: ${thumb}\n`;
          text += `Notes: ${item.notes || "(none written)"}\n\n`;
        });

        const wrote     = answers.filter(a => a.wroteNote).length;
        const thumbUp   = answers.filter(a => a.thumb === "up").length;
        const thumbDown = answers.filter(a => a.thumb === "down").length;
        text += `${"=".repeat(40)}\n`;
        text += `Summary: ${answers.length} check-ins | ${wrote} with notes | ${thumbUp} clear, ${thumbDown} unclear\n`;

        downloadFile(`reading_notes_${log.sessionId}.txt`, text, "text/plain");
        status.textContent = `Saved: reading_notes_${log.sessionId}.txt`;
        setTimeout(() => { status.textContent = ""; }, 4000);
      });
    });
  }

  // ── Helper ───────────────────────────────────────────────────────────
  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  console.log("[Liminal Reader] logger.js ready.");

})();
