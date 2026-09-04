/**
 * Client-side speed test against this server's own /api/speedtest/*
 * endpoints. Follows the same methodology real speed test services use
 * (Speedtest.net/fast.com), not a naive single-request timing:
 *
 *  1. Ping measured *before* the load test, via several sequential
 *     round trips to an endpoint that does nothing — measuring latency
 *     while the link is idle, not while it's saturated by the load test.
 *  2. Download/upload use several PARALLEL connections (a single TCP
 *     stream often can't saturate a fast link — window scaling and
 *     congestion control limit one stream's throughput well below the
 *     link's real capacity).
 *  3. Tests are DURATION-based, not size-based: run for a fixed window
 *     and see how many bytes moved, rather than requesting N bytes and
 *     waiting for them to finish (which either finishes almost
 *     instantly on a fast link, measuring nothing meaningful, or drags
 *     on forever on a slow one).
 *  4. The first second of each test is discarded from the throughput
 *     calculation — TCP's slow-start ramp means early throughput
 *     under-reports the link's steady-state speed.
 */
(function () {
  // ---- Dark/light theme toggle ----
  // Explicit user choice, not prefers-color-scheme — stored so it
  // survives a reload. Defaults to dark (this app's original look) if
  // nothing was chosen yet or localStorage isn't available (private
  // browsing, etc. — falls back to the default rather than breaking).
  const THEME_KEY = "nettapesh-theme";
  const themeToggleBtn = document.getElementById("themeToggle");

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggleBtn.querySelectorAll(".theme-toggle-half").forEach((half) => {
      half.classList.toggle("active", half.dataset.themeChoice === theme);
    });
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      // best-effort — theme just won't persist across reloads
    }
  }

  applyTheme(getStoredTheme() === "light" ? "light" : "dark");
  themeToggleBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(next);
    setStoredTheme(next);
    refreshChartTheme();
  });

  // ---- Language (fa/en) ----
  // A real switch, not decoration: every static string in the page
  // carries a data-i18n (textContent) or data-i18n-aria (aria-label)
  // key, applied by applyLanguage() below; dynamically-generated
  // strings (results overlay, ping log rows, chart labels, status
  // messages) all go through t() at the point they're built instead of
  // being hardcoded Persian, so switching languages mid-session
  // updates them too, not just what was on screen at load time.
  const LANG_KEY = "nettapesh-lang";
  const I18N = {
    fa: {
      "lang.name": "فارسی",
      "tab.speedtest": "تست سرعت",
      "tab.continuousPing": "تست پیوسته",
      "stat.download": "دانلود",
      "stat.upload": "آپلود",
      "mini.ping": "پینگ",
      "mini.jitter": "جیتر",
      "start.button": "شروع تست",
      "history.title": "تاریخچه",
      "range.day": "روز",
      "range.week": "هفته",
      "history.download": "دانلود (Mbps)",
      "history.upload": "آپلود (Mbps)",
      "pingtab.start": "شروع",
      "pingtab.stop": "توقف",
      "ping.rounds": "دورها",
      "ping.avgPing": "میانگین پینگ",
      "ping.avgDown": "میانگین دانلود",
      "ping.avgUp": "میانگین آپلود",
      "ping.empty": "دکمه‌ی شروع رو بزنید تا دورهای پشت‌سرهم پینگ/دانلود/آپلود شروع بشه.",
      "ping.pingLabel": "پینگ",
      "ping.error": "خطا در اتصال",
      "footer.desc": "اسپیدتست اینترنت خودمیزبان — بدون نصب، بدون حساب کاربری. پینگ، دانلود و آپلود مستقیماً در برابر همین سرور اندازه‌گیری می‌شه.",
      "footer.github": "مخزن GitHub",
      "footer.copyright": "© {year} netTAPESH — ساخته‌شده با FastAPI و جاوااسکریپت خالص.",
      "theme.toggle": "تغییر تم روشن/تیره",
      "results.close": "بستن",
      "results.download": "دانلود Mbps",
      "results.upload": "آپلود Mbps",
      "results.pingMs": "پینگ ms",
      "results.jitterMs": "جیتر ms",
      "results.connection": "اتصال",
      "results.connectionValue": "چندگانه (۴ کانکشن موازی)",
      "results.isp": "ارائه‌دهنده",
      "results.ip": "آی‌پی شما",
      "results.location": "لوکیشن",
      "quality.browsing": "وب‌گردی",
      "quality.gaming": "گیم آنلاین",
      "quality.streaming": "استریم ویدیو",
      "quality.videocall": "تماس تصویری",
      "testing.ping": "در حال تست پینگ…",
      "testing.download": "در حال تست دانلود…",
      "testing.upload": "در حال تست آپلود…",
      "result.done": "تست در {date} انجام شد",
      "result.error": "خطا در اجرای تست — دوباره امتحان کن.",
      "result.last": "آخرین تست: {date}",
    },
    en: {
      "lang.name": "English",
      "tab.speedtest": "Speed Test",
      "tab.continuousPing": "Continuous Test",
      "stat.download": "Download",
      "stat.upload": "Upload",
      "mini.ping": "Ping",
      "mini.jitter": "Jitter",
      "start.button": "Start Test",
      "history.title": "History",
      "range.day": "Day",
      "range.week": "Week",
      "history.download": "Download (Mbps)",
      "history.upload": "Upload (Mbps)",
      "pingtab.start": "Start",
      "pingtab.stop": "Stop",
      "ping.rounds": "Rounds",
      "ping.avgPing": "Avg Ping",
      "ping.avgDown": "Avg Download",
      "ping.avgUp": "Avg Upload",
      "ping.empty": "Click Start to begin continuous ping/download/upload rounds.",
      "ping.pingLabel": "Ping",
      "ping.error": "Connection error",
      "footer.desc": "Self-hosted internet speed test — no install, no account. Ping, download, and upload are measured directly against this same server.",
      "footer.github": "GitHub Repo",
      "footer.copyright": "© {year} netTAPESH — built with FastAPI and vanilla JavaScript.",
      "theme.toggle": "Toggle light/dark theme",
      "results.close": "Close",
      "results.download": "Download Mbps",
      "results.upload": "Upload Mbps",
      "results.pingMs": "Ping ms",
      "results.jitterMs": "Jitter ms",
      "results.connection": "Connection",
      "results.connectionValue": "Multiple (4 parallel connections)",
      "results.isp": "ISP",
      "results.ip": "Your IP",
      "results.location": "Location",
      "quality.browsing": "Web Browsing",
      "quality.gaming": "Online Gaming",
      "quality.streaming": "Video Streaming",
      "quality.videocall": "Video Chat",
      "testing.ping": "Testing ping…",
      "testing.download": "Testing download…",
      "testing.upload": "Testing upload…",
      "result.done": "Test completed at {date}",
      "result.error": "Test failed — please try again.",
      "result.last": "Last test: {date}",
    },
  };

  let currentLang = "fa";

  function t(key, vars) {
    const dict = I18N[currentLang] || I18N.fa;
    let str = dict[key] || I18N.fa[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
    }
    return str;
  }

  function localeName() {
    return currentLang === "fa" ? "fa-IR" : "en-US";
  }

  const langSwitcherBtn = document.getElementById("langSwitcherBtn");
  const langSwitcherLabelEl = document.getElementById("langSwitcherLabel");
  const langMenuEl = document.getElementById("langMenu");

  function getStoredLang() {
    try {
      return localStorage.getItem(LANG_KEY);
    } catch (e) {
      return null;
    }
  }
  function setStoredLang(lang) {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      // best-effort — language just won't persist across reloads
    }
  }

  function renderFooterBottom() {
    document.getElementById("footerBottom").innerHTML =
      t("footer.copyright", { year: `<span id="footerYear">${new Date().getFullYear()}</span>` });
  }

  // applyLanguage() references pingLoopToggleBtn/pingLoopRunning/
  // historyChartDown/loadHistory even though they're declared further
  // down in this same closure — safe because this function's BODY only
  // runs when called (the initial call and the click handler below are
  // both after the whole script has finished executing top to bottom),
  // not at definition time, so those bindings are long since
  // initialized by then.
  function applyLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    // Deliberately NOT toggling dir with the language — an earlier
    // version flipped the whole page rtl/ltr per language, which
    // physically moved every element (tabs, header controls, gauge
    // side info, ...) to the opposite side on every switch. Per
    // feedback, layout position should stay fixed; only the text
    // changes. The layout stays RTL always, English text just reads
    // right-aligned within it rather than the page mirroring.
    langSwitcherLabelEl.textContent = t("lang.name");
    langMenuEl.querySelectorAll(".lang-menu-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.lang === lang);
    });

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });

    // The continuous-ping start/stop button's label depends on running
    // state too, not just language — re-derive rather than assume.
    pingLoopBtnLabelEl.textContent = pingLoopRunning ? t("pingtab.stop") : t("pingtab.start");

    renderFooterBottom();
    updateNowStamp();
    refreshChartTheme();
    loadHistory(document.querySelector('.range-toggle[data-target="history"] button.active').dataset.range);
  }

  function closeLangMenu() {
    langMenuEl.hidden = true;
    langSwitcherBtn.setAttribute("aria-expanded", "false");
  }

  langSwitcherBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = langMenuEl.hidden;
    langMenuEl.hidden = !opening;
    langSwitcherBtn.setAttribute("aria-expanded", String(opening));
  });

  langMenuEl.querySelectorAll(".lang-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      applyLanguage(item.dataset.lang);
      setStoredLang(item.dataset.lang);
      closeLangMenu();
    });
  });

  document.addEventListener("click", (e) => {
    if (!langMenuEl.hidden && !e.target.closest("#langSwitcher")) closeLangMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLangMenu();
  });

  const PING_SAMPLES = 10;
  const PARALLEL_CONNECTIONS = 4;
  const TEST_DURATION_MS = 8000;
  const WARMUP_MS = 1000;
  const UPDATE_INTERVAL_MS = 200;

  const runBtn = document.getElementById("runBtn");
  const runBtnLabel = document.getElementById("runBtnLabel");
  const testPhaseEl = document.getElementById("testPhase");
  const rPing = document.getElementById("rPing");
  const rJitter = document.getElementById("rJitter");
  const rDown = document.getElementById("rDown");
  const rUp = document.getElementById("rUp");
  const rDownUnit = document.getElementById("rDownUnit");
  const rUpUnit = document.getElementById("rUpUnit");
  const unitToggle = document.getElementById("unitToggle");
  const resultMetaEl = document.getElementById("resultMeta");
  const gaugeLiveValue = document.getElementById("gaugeLiveValue");
  const speedoWrapEl = document.getElementById("speedoWrap");
  const nowStampEl = document.getElementById("nowStamp");
  const ispNameEl = document.getElementById("ispName");
  const locationNameEl = document.getElementById("locationName");
  const resultsOverlay = document.getElementById("resultsOverlay");
  const resultsCloseBtn = document.getElementById("resultsCloseBtn");
  const resDown = document.getElementById("resDown");
  const resUp = document.getElementById("resUp");
  const resPing = document.getElementById("resPing");
  const resJitter = document.getElementById("resJitter");
  const resIsp = document.getElementById("resIsp");
  const resIp = document.getElementById("resIp");
  const resLocation = document.getElementById("resLocation");
  const resultsQualityRow = document.getElementById("resultsQualityRow");
  const resultsTimestampEl = document.getElementById("resultsTimestamp");

  // ---- Clock (top-right timestamp, like Ookla's) ----
  function updateNowStamp() {
    nowStampEl.textContent = new Date().toLocaleString(localeName(), {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  updateNowStamp();
  setInterval(updateNowStamp, 30000);

  // ---- ISP / location (fetched once — by IP, server-side, see
  // backend/api/routes.py speedtest_client_info) ----
  // Cached in module scope (not just written into the DOM) because the
  // results overlay needs the same isp/location/ip values again when a
  // test finishes, without a second round trip.
  let clientInfo = { isp: null, location: null, ip: null };

  async function loadClientInfo() {
    try {
      const res = await fetch("/api/speedtest/client-info");
      const data = await res.json();
      clientInfo = data;
      ispNameEl.textContent = data.isp || "—";
      locationNameEl.textContent = data.location || "—";
    } catch (e) {
      // best-effort — leave the "—" placeholders
    }
  }
  loadClientInfo();

  // ---- Results overlay (full-screen summary shown after a test
  // finishes, styled after a real Speedtest.net results screen) ----
  // Connection-quality "star" ratings aren't something this app can
  // measure directly (that needs real gaming/streaming traffic, which
  // is what Ookla's apps actually do) — this is a documented heuristic
  // approximation from ping/jitter/download/upload, not a measured
  // score, so it's presented as illustrative rather than authoritative.
  const QUALITY_CATEGORIES = [
    {
      key: "browsing",
      labelKey: "quality.browsing",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18" stroke-linecap="round"/></svg>',
      score: ({ ping, download }) => scoreFromThresholds(download, [1, 5, 15, 30]) - (ping > 150 ? 1 : 0),
    },
    {
      key: "gaming",
      labelKey: "quality.gaming",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 12h.01M18.5 10h.01" stroke-linecap="round"/></svg>',
      score: ({ ping, jitter }) => scoreFromThresholds(150 - ping, [0, 50, 90, 120]) - (jitter > 20 ? 1 : 0),
    },
    {
      key: "streaming",
      labelKey: "quality.streaming",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="15" height="14" rx="2"/><path d="M17 8l5-3v14l-5-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      score: ({ download }) => scoreFromThresholds(download, [2, 5, 15, 25]),
    },
    {
      key: "videocall",
      labelKey: "quality.videocall",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="15" height="12" rx="2"/><path d="M17 10l5-3v10l-5-3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="11" r="2.2"/></svg>',
      score: ({ ping, jitter, upload }) => scoreFromThresholds(Math.min(upload, 100 - ping), [0, 5, 15, 25]) - (jitter > 30 ? 1 : 0),
    },
  ];

  // Maps a value against ascending thresholds to a 1-5 dot score —
  // below the first threshold is 1, at/above the last is 5.
  function scoreFromThresholds(value, thresholds) {
    let score = 1;
    for (const t of thresholds) {
      if (value >= t) score++;
    }
    return Math.max(1, Math.min(5, score));
  }

  function renderQualityDots(score) {
    return Array.from({ length: 5 }, (_, i) =>
      `<span class="results-quality-dot${i < score ? " filled" : ""}"></span>`
    ).join("");
  }

  function showResultsOverlay(result) {
    resDown.textContent = formatSpeed(result.download_mbps);
    resUp.textContent = formatSpeed(result.upload_mbps);
    resPing.textContent = result.ping_ms.toFixed(0);
    resJitter.textContent = result.jitter_ms.toFixed(1);
    resIsp.textContent = clientInfo.isp || "—";
    resIp.textContent = clientInfo.ip || "—";
    resLocation.textContent = clientInfo.location || "—";
    resultsTimestampEl.textContent = t("result.done", { date: new Date().toLocaleString(localeName()) });

    resultsQualityRow.innerHTML = QUALITY_CATEGORIES.map((cat) => {
      const score = cat.score({
        ping: result.ping_ms,
        jitter: result.jitter_ms,
        download: result.download_mbps,
        upload: result.upload_mbps,
      });
      return `
        <div class="results-quality-item">
          <span class="icon">${cat.icon}</span>
          <span class="results-quality-label">${t(cat.labelKey)}</span>
          <span class="results-quality-dots">${renderQualityDots(score)}</span>
        </div>
      `;
    }).join("");

    resultsOverlay.hidden = false;
  }

  resultsCloseBtn.addEventListener("click", () => {
    resultsOverlay.hidden = true;
    // The main start button hides once a test completes (see runTest())
    // — closing the overlay without starting another test is the one
    // way back to it, otherwise there'd be no way to test again from
    // the main page at all.
    runBtn.hidden = false;
  });

  const resultsRestartBtn = document.getElementById("resultsRestartBtn");
  resultsRestartBtn.addEventListener("click", () => {
    resultsOverlay.hidden = true;
    runTest();
  });

  // ---- Speedometer gauge (needle dial) ----
  // A non-linear tick scale, same idea as a real speedometer: equal
  // ANGLE between ticks, unequal VALUE between them, so the low end
  // (where most real-world results land) gets most of the dial instead
  // of being crushed into a sliver next to a mostly-empty high end.
  // Piecewise-linear interpolation between whichever two ticks bracket
  // the live value maps that value to an angle — monotonic by
  // construction (each segment only moves the needle forward), so
  // there's no possibility of the backward "jump" a discrete auto-
  // scaling tier system had in an earlier version.
  const GAUGE_TICKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
  const GAUGE_START_DEG = -125; // needle angle at value 0 (down-left)
  const GAUGE_END_DEG = 125; // needle angle at the top tick (down-right)
  const SPEEDO_CENTER = { x: 110, y: 110 };
  const SPEEDO_RADIUS = 88;

  function speedToAngle(mbpsValue) {
    const v = Math.max(0, Math.min(mbpsValue, GAUGE_TICKS[GAUGE_TICKS.length - 1]));
    let i = 0;
    while (i < GAUGE_TICKS.length - 2 && v > GAUGE_TICKS[i + 1]) i++;
    const segStart = GAUGE_TICKS[i];
    const segEnd = GAUGE_TICKS[i + 1];
    const segFrac = segEnd > segStart ? (v - segStart) / (segEnd - segStart) : 0;
    const idxFrac = (i + segFrac) / (GAUGE_TICKS.length - 1);
    return GAUGE_START_DEG + idxFrac * (GAUGE_END_DEG - GAUGE_START_DEG);
  }

  // angle 0 = straight up, positive = clockwise — matches how the
  // needle's rotate() transform is applied below.
  function polarPoint(angleDeg, radius) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: SPEEDO_CENTER.x + radius * Math.sin(rad),
      y: SPEEDO_CENTER.y - radius * Math.cos(rad),
    };
  }

  function buildSpeedoSvg() {
    const svg = document.getElementById("speedoSvg");
    const svgNS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs) => {
      const node = document.createElementNS(svgNS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      return node;
    };

    // Background track arc.
    const start = polarPoint(GAUGE_START_DEG, SPEEDO_RADIUS);
    const end = polarPoint(GAUGE_END_DEG, SPEEDO_RADIUS);
    svg.appendChild(
      el("path", {
        class: "speedo-track",
        d: `M ${start.x} ${start.y} A ${SPEEDO_RADIUS} ${SPEEDO_RADIUS} 0 1 1 ${end.x} ${end.y}`,
      })
    );

    // Minor ticks — purely decorative texture between the major
    // labeled ticks, evenly spaced by angle.
    const MINOR_PER_SEGMENT = 4;
    const totalMinor = (GAUGE_TICKS.length - 1) * MINOR_PER_SEGMENT;
    for (let m = 0; m <= totalMinor; m++) {
      if (m % MINOR_PER_SEGMENT === 0) continue; // skip where a major tick goes
      const angle = GAUGE_START_DEG + (m / totalMinor) * (GAUGE_END_DEG - GAUGE_START_DEG);
      const p1 = polarPoint(angle, SPEEDO_RADIUS + 11);
      const p2 = polarPoint(angle, SPEEDO_RADIUS + 15);
      svg.appendChild(el("line", { class: "speedo-tick-minor", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }));
    }

    // Major ticks + number labels.
    GAUGE_TICKS.forEach((tick, i) => {
      const angle = GAUGE_START_DEG + (i / (GAUGE_TICKS.length - 1)) * (GAUGE_END_DEG - GAUGE_START_DEG);
      const p1 = polarPoint(angle, SPEEDO_RADIUS + 9);
      const p2 = polarPoint(angle, SPEEDO_RADIUS + 17);
      svg.appendChild(el("line", { class: "speedo-tick-major", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }));
      const labelPos = polarPoint(angle, SPEEDO_RADIUS + 28);
      const label = el("text", { class: "speedo-tick-label", x: labelPos.x, y: labelPos.y });
      label.textContent = String(tick);
      svg.appendChild(label);
    });

    // Needle gradient (defined once, referenced by the needle's stroke).
    // gradientUnits="userSpaceOnUse" with explicit coordinates, not the
    // default objectBoundingBox — the needle <line> is perfectly
    // vertical before rotation (x1 === x2), so its bounding box has
    // ZERO width, which is degenerate for objectBoundingBox units; the
    // SVG spec says a paint server referencing a degenerate bounding
    // box is ignored entirely, silently making the needle invisible.
    const defs = el("defs", {});
    const grad = el("linearGradient", {
      id: "speedoNeedleGrad",
      gradientUnits: "userSpaceOnUse",
      x1: SPEEDO_CENTER.x,
      y1: SPEEDO_CENTER.y,
      x2: SPEEDO_CENTER.x,
      y2: SPEEDO_CENTER.y - SPEEDO_RADIUS + 14,
    });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "#5b6478" }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "#e8ecf5" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Needle — pivots around SPEEDO_CENTER via CSS transform (see
    // .speedo-needle's transform-box/transform-origin in style.css),
    // rotated per-frame in updateGauge()/resetGauge() below.
    const needle = el("line", {
      id: "speedoNeedle",
      class: "speedo-needle",
      x1: SPEEDO_CENTER.x,
      y1: SPEEDO_CENTER.y,
      x2: SPEEDO_CENTER.x,
      y2: SPEEDO_CENTER.y - SPEEDO_RADIUS + 14,
    });
    svg.appendChild(needle);
    svg.appendChild(el("circle", { class: "speedo-hub", cx: SPEEDO_CENTER.x, cy: SPEEDO_CENTER.y, r: 6 }));
  }
  buildSpeedoSvg();
  const speedoNeedleEl = document.getElementById("speedoNeedle");
  const speedoUnitIconEl = document.getElementById("speedoUnitIcon");
  const speedoUnitLabelEl = document.getElementById("speedoUnitLabel");

  function setSpeedoDirection(direction) {
    // direction: "down" (download) or "up" (upload) — swaps the little
    // arrow next to the unit label so the dial reads correctly for
    // whichever phase is currently running.
    speedoUnitIconEl.classList.toggle("icon-down", direction === "down");
    speedoUnitIconEl.classList.toggle("icon-up", direction === "up");
    speedoUnitIconEl.querySelector("path").setAttribute(
      "d",
      direction === "up" ? "M12 20V6M6 12l6-6 6 6" : "M12 4v14M6 12l6 6 6-6"
    );
  }

  function resetGauge() {
    speedoNeedleEl.style.transform = `rotate(${GAUGE_START_DEG}deg)`;
    gaugeLiveValue.textContent = "0.00";
  }

  function updateGauge(mbpsValue) {
    speedoNeedleEl.style.transform = `rotate(${speedToAngle(mbpsValue)}deg)`;
    gaugeLiveValue.textContent = mbpsValue.toFixed(2);
  }

  function mbps(bytes, seconds) {
    if (seconds <= 0) return 0;
    return (bytes * 8) / (seconds * 1_000_000);
  }

  // ---- Display unit (Mbps vs MB/s) — a pure display toggle, all
  // internal math and history/API values stay in Mbps regardless ----
  let currentUnit = "mbps"; // "mbps" | "MBps"
  let lastDownloadMbps = null;
  let lastUploadMbps = null;

  function formatSpeed(mbpsValue) {
    if (mbpsValue == null) return "—";
    return currentUnit === "MBps" ? (mbpsValue / 8).toFixed(2) : mbpsValue.toFixed(1);
  }

  function setDownloadDisplay(mbpsValue, live) {
    lastDownloadMbps = mbpsValue;
    rDown.textContent = formatSpeed(mbpsValue);
    if (live && mbpsValue != null) updateGauge(mbpsValue);
  }

  function setUploadDisplay(mbpsValue, live) {
    lastUploadMbps = mbpsValue;
    rUp.textContent = formatSpeed(mbpsValue);
    if (live && mbpsValue != null) updateGauge(mbpsValue);
  }

  unitToggle.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    currentUnit = e.target.dataset.unit;
    unitToggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target));
    const unitLabel = currentUnit === "MBps" ? "MB/s" : "Mbps";
    rDownUnit.textContent = unitLabel;
    rUpUnit.textContent = unitLabel;
    rDown.textContent = formatSpeed(lastDownloadMbps);
    rUp.textContent = formatSpeed(lastUploadMbps);
  });

  // ---- Ping (sequential, before any load on the link) ----
  async function measurePing() {
    const samples = [];
    for (let i = 0; i < PING_SAMPLES; i++) {
      const t0 = performance.now();
      await fetch("/api/speedtest/ping", { cache: "no-store" });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    const jitter = samples.reduce((sum, s) => sum + Math.abs(s - avg), 0) / samples.length;
    return { ping_ms: median, jitter_ms: jitter };
  }

  /**
   * Runs `workerFn` on PARALLEL_CONNECTIONS lanes for TEST_DURATION_MS,
   * calling `onBytes(n)` from any lane whenever it moves n more bytes,
   * and `onTick()` roughly every UPDATE_INTERVAL_MS with the live
   * warmup-adjusted Mbps so far. Returns the final Mbps, computed only
   * from bytes moved after WARMUP_MS (see module docstring point 4).
   */
  async function runParallelTest(workerFn, onTick) {
    let totalBytes = 0;
    let bytesAtWarmup = null;
    const t0 = performance.now();
    const controller = new AbortController();

    const tickTimer = setInterval(() => {
      const elapsedMs = performance.now() - t0;
      if (bytesAtWarmup === null && elapsedMs >= WARMUP_MS) {
        bytesAtWarmup = totalBytes;
      }
      if (bytesAtWarmup !== null) {
        const steadySec = (elapsedMs - WARMUP_MS) / 1000;
        onTick(mbps(totalBytes - bytesAtWarmup, steadySec));
      }
    }, UPDATE_INTERVAL_MS);

    const abortTimer = setTimeout(() => controller.abort(), TEST_DURATION_MS);

    const lanes = Array.from({ length: PARALLEL_CONNECTIONS }, () =>
      workerFn(controller.signal, (n) => {
        totalBytes += n;
      })
    );
    await Promise.allSettled(lanes);

    clearInterval(tickTimer);
    clearTimeout(abortTimer);

    const totalElapsedMs = performance.now() - t0;
    if (bytesAtWarmup === null) {
      // Test ended before warmup elapsed (very slow link, or aborted
      // early) — fall back to the whole window rather than reporting 0.
      return mbps(totalBytes, totalElapsedMs / 1000);
    }
    const steadySec = (totalElapsedMs - WARMUP_MS) / 1000;
    return mbps(totalBytes - bytesAtWarmup, steadySec);
  }

  // ---- Download: N parallel streams, each requesting far more than
  // could be consumed in TEST_DURATION_MS, aborted when time's up ----
  async function downloadLane(signal, onBytes) {
    try {
      const res = await fetch("/api/speedtest/download", { signal, cache: "no-store" });
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onBytes(value.length);
      }
    } catch (e) {
      // aborted when the test window ended — expected, not an error
    }
  }

  function measureDownload() {
    return runParallelTest(downloadLane, (v) => setDownloadDisplay(v, true));
  }

  // ---- Upload: N parallel lanes, each looping fixed-size chunk POSTs
  // (not one giant body — keeps browser memory bounded) until aborted.
  //
  // Uses XMLHttpRequest, not fetch — deliberately. An earlier version
  // used fetch() and counted a chunk as "sent" only once the whole POST
  // resolved. That's fine on a fast link, but on a slow one (say a few
  // Mbps upload — common, not an edge case) a single 4 MB chunk can take
  // longer than the entire test window to finish, so onBytes() never
  // fires even once and the result comes back as a flat 0 Mbps — this
  // is the real bug a report of "upload shows 0" turned out to be.
  // XHR's upload.onprogress fires incrementally as bytes actually go
  // out over the wire, the same way the download side already tracks
  // partial progress via its stream reader, so throughput is measured
  // correctly regardless of whether any single chunk ever completes
  // before the window ends. ----
  const UPLOAD_CHUNK_BYTES = 4_000_000;
  const _uploadBuffer = new Uint8Array(UPLOAD_CHUNK_BYTES);

  function xhrUploadOnce(signal, onBytes) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      const xhr = new XMLHttpRequest();
      let lastLoaded = 0;
      xhr.open("POST", "/api/speedtest/upload");
      xhr.upload.onprogress = (e) => {
        onBytes(e.loaded - lastLoaded);
        lastLoaded = e.loaded;
      };
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("upload network error"));
      xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
      const onSignalAbort = () => xhr.abort();
      signal.addEventListener("abort", onSignalAbort, { once: true });
      xhr.send(_uploadBuffer);
    });
  }

  async function uploadLane(signal, onBytes) {
    try {
      while (!signal.aborted) {
        await xhrUploadOnce(signal, onBytes);
      }
    } catch (e) {
      // aborted mid-chunk — bytes already sent were counted incrementally
      // via onprogress above, so nothing is lost by the abort itself
    }
  }

  function measureUpload() {
    return runParallelTest(uploadLane, (v) => setUploadDisplay(v, true));
  }

  async function saveResult(result) {
    try {
      await fetch("/api/speedtest/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
    } catch (e) {
      // best-effort — losing one history row isn't worth surfacing an error
    }
  }

  async function runTest() {
    speedoWrapEl.hidden = false; // reveal the dial now that a test is actually running
    runBtn.hidden = true; // hide the moment the test starts, not just once it finishes
    runBtn.disabled = true;
    rPing.textContent = "—";
    rJitter.textContent = "—";
    setDownloadDisplay(null);
    setUploadDisplay(null);
    resultMetaEl.textContent = "";
    resetGauge();

    try {
      testPhaseEl.textContent = t("testing.ping");
      const { ping_ms, jitter_ms } = await measurePing();
      rPing.textContent = ping_ms.toFixed(0);
      rJitter.textContent = jitter_ms.toFixed(1);

      setSpeedoDirection("down");
      testPhaseEl.textContent = t("testing.download");
      const download_mbps = await measureDownload();
      setDownloadDisplay(download_mbps);

      resetGauge(); // fresh scale for upload — often a very different range than download
      setSpeedoDirection("up");
      testPhaseEl.textContent = t("testing.upload");
      const upload_mbps = await measureUpload();
      setUploadDisplay(upload_mbps);

      testPhaseEl.textContent = "";
      resultMetaEl.textContent = t("result.done", { date: new Date().toLocaleString(localeName()) });

      const result = { ping_ms, jitter_ms, download_mbps, upload_mbps };
      await saveResult(result);
      loadHistory(document.querySelector('.range-toggle[data-target="history"] button.active').dataset.range);
      // The results overlay (with its own, smaller start-another-test
      // button) takes over from here — hide the main one so it's not
      // sitting there redundantly once you close back to the main page.
      runBtn.hidden = true;
      showResultsOverlay(result);
    } catch (e) {
      testPhaseEl.textContent = "";
      resultMetaEl.textContent = t("result.error");
      resetGauge();
      // No results overlay (with its own restart button) shows on
      // error — bring the main button back or there'd be no way to
      // retry at all.
      runBtn.hidden = false;
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener("click", runTest);

  // ---- History charts (two separate bar charts, download and upload
  // stacked one above the other, per user request) ----
  // Each bar is one saved test result, labeled by the time it ran — a
  // CATEGORY x-axis (one discrete label per test), not a continuous
  // time scale, since the point is comparing individual runs against
  // each other, not tracing a continuous quantity over time.
  // Chart.js bakes color strings into its config at creation time — it
  // doesn't read CSS custom properties live — so tick/grid colors are
  // pulled from the current theme's computed CSS vars here, and
  // re-applied by refreshChartTheme() whenever the theme toggles (see
  // #themeToggle above), or the light-mode grid/labels would stay
  // stuck with dark-mode colors after a switch.
  function themeVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function makeHistoryBarChart(canvasId, color) {
    return new Chart(document.getElementById(canvasId).getContext("2d"), {
      type: "bar",
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: color,
            borderRadius: 4,
            maxBarThickness: 48,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        scales: {
          x: { ticks: { color: themeVar("--text-dim") }, grid: { display: false } },
          y: {
            ticks: { color: themeVar("--text-dim") },
            grid: { color: themeVar("--border") },
            beginAtZero: true,
            title: { display: true, text: "Mbps", color: themeVar("--text-dim") },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  const historyChartDown = makeHistoryBarChart("historyChartDown", "#4f8cff");
  const historyChartUp = makeHistoryBarChart("historyChartUp", "#33c07c");

  function refreshChartTheme() {
    [historyChartDown, historyChartUp].forEach((chart) => {
      chart.options.scales.x.ticks.color = themeVar("--text-dim");
      chart.options.scales.y.ticks.color = themeVar("--text-dim");
      chart.options.scales.y.grid.color = themeVar("--border");
      chart.options.scales.y.title.color = themeVar("--text-dim");
      chart.update();
    });
  }

  // Label format depends on range: a single day of tests only needs the
  // time; a week needs the date too, or same-time tests on different
  // days would look identical on the x-axis.
  function formatHistoryLabel(ts, range) {
    const d = new Date(ts);
    return range === "week"
      ? d.toLocaleString(localeName(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString(localeName(), { hour: "2-digit", minute: "2-digit" });
  }

  async function loadHistory(range) {
    const res = await fetch(`/api/speedtest/history?range=${range}`);
    const data = await res.json();

    const downRows = data.results.filter((r) => r.download_mbps != null);
    const upRows = data.results.filter((r) => r.upload_mbps != null);

    historyChartDown.data.labels = downRows.map((r) => formatHistoryLabel(r.timestamp, range));
    historyChartDown.data.datasets[0].data = downRows.map((r) => r.download_mbps);
    historyChartDown.update();

    historyChartUp.data.labels = upRows.map((r) => formatHistoryLabel(r.timestamp, range));
    historyChartUp.data.datasets[0].data = upRows.map((r) => r.upload_mbps);
    historyChartUp.update();
  }

  document.querySelectorAll(".range-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      toggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target));
      loadHistory(e.target.dataset.range);
    });
  });

  async function loadLatest() {
    const res = await fetch("/api/speedtest/latest");
    const data = await res.json();
    if (!data.result) return;
    const r = data.result;
    if (r.ping_ms != null) rPing.textContent = r.ping_ms.toFixed(0);
    if (r.jitter_ms != null) rJitter.textContent = r.jitter_ms.toFixed(1);
    if (r.download_mbps != null) setDownloadDisplay(r.download_mbps);
    if (r.upload_mbps != null) setUploadDisplay(r.upload_mbps);
    resultMetaEl.textContent = t("result.last", { date: new Date(r.timestamp).toLocaleString(localeName()) });
  }

  resetGauge();

  // ---- Tab nav ----
  function switchTab(tabName) {
    document.querySelectorAll(".tab-nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
    document.querySelectorAll(".page-tab").forEach((tab) => {
      tab.hidden = tab.id !== `tab-${tabName}`;
    });
  }
  document.querySelectorAll(".tab-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  // Footer shortcuts to each tab — same switch, just a second entry
  // point.
  document.querySelectorAll("[data-tab-link]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(link.dataset.tabLink);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // ---- Continuous ping + mini download/upload (like `ping -t`, plus a
  // lightweight speed reading every round) ----
  // Each round measures three things: ping (round trip to an endpoint
  // that does nothing but reply instantly), a small download probe, and
  // a small upload probe — single-request timing, not the parallel
  // duration-based methodology the main speed test uses, since the
  // point here is a quick per-round reading repeated many times, not
  // one maximally-accurate number. Probe sizes are deliberately small
  // (500 KB down / 250 KB up) so a round stays quick even on a slow
  // link and repeating this continuously doesn't add real bandwidth
  // load — still nowhere near the main test's hundreds of MB.
  const PING_LOOP_DOWNLOAD_BYTES = 500_000;
  const PING_LOOP_UPLOAD_BYTES = 250_000;
  const pingLoopUploadBuffer = new Uint8Array(PING_LOOP_UPLOAD_BYTES);

  const pingLoopToggleBtn = document.getElementById("pingLoopToggleBtn");
  const pingLoopBtnLabelEl = document.getElementById("pingLoopBtnLabel");
  const pingLogEl = document.getElementById("pingLog");
  const pingLogEmptyEl = document.getElementById("pingLogEmpty");
  const pingSummaryRowEl = document.getElementById("pingSummaryRow");
  const pingSummaryRoundsEl = document.getElementById("pingSummaryRounds");
  const pingSummaryPingEl = document.getElementById("pingSummaryPing");
  const pingSummaryDownEl = document.getElementById("pingSummaryDown");
  const pingSummaryUpEl = document.getElementById("pingSummaryUp");
  let pingLoopRunning = false;
  let pingLoopPingSamples = [];
  let pingLoopDownSamples = [];
  let pingLoopUpSamples = [];
  let pingLoopSeq = 0;

  // Traffic-light thresholds — ping in ms (lower is better), down/up in
  // Mbps (higher is better). Same "good/warn/bad" 3-tier read as a real
  // ping tool's colored latency, extended here to the two speed probes
  // too. The Mbps cutoffs are a rough general-purpose heuristic (fine
  // for browsing/streaming at the low end, clearly fast above it), not
  // measured against any particular use case.
  function pingQualityClass(ms) {
    if (ms < 100) return "ping-good";
    if (ms <= 400) return "ping-warn";
    return "ping-bad";
  }
  function speedQualityClass(mbpsValue) {
    if (mbpsValue >= 25) return "ping-good";
    if (mbpsValue >= 5) return "ping-warn";
    return "ping-bad";
  }

  function pingBadge(text, cls) {
    const span = document.createElement("span");
    span.className = "ping-badge " + cls;
    span.textContent = text;
    return span;
  }

  function appendPingLogLine(pingMs, downMbps, upMbps, isError) {
    pingLogEmptyEl.hidden = true;
    pingLogEl.hidden = false;

    const row = document.createElement("div");
    row.className = "ping-row" + (isError ? " error" : "");
    if (isError) {
      const seq = document.createElement("span");
      seq.className = "ping-row-seq";
      seq.textContent = `#${pingLoopSeq}`;
      const err = document.createElement("span");
      err.className = "ping-row-error";
      err.textContent = t("ping.error");
      row.append(seq, err);
    } else {
      const seq = document.createElement("span");
      seq.className = "ping-row-seq";
      seq.textContent = `#${pingLoopSeq}`;
      row.append(
        seq,
        pingBadge(`${t("ping.pingLabel")} ${pingMs.toFixed(0)}ms`, pingQualityClass(pingMs)),
        pingBadge(`↓ ${downMbps.toFixed(1)} Mbps`, speedQualityClass(downMbps)),
        pingBadge(`↑ ${upMbps.toFixed(1)} Mbps`, speedQualityClass(upMbps))
      );
    }
    pingLogEl.appendChild(row);
    pingLogEl.scrollTop = pingLogEl.scrollHeight;
  }

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function renderPingStats() {
    if (pingLoopPingSamples.length === 0) return;
    pingSummaryRowEl.hidden = false;
    pingSummaryRoundsEl.textContent =
      currentLang === "fa" ? String(pingLoopSeq).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]) : String(pingLoopSeq);
    pingSummaryPingEl.textContent = `${avg(pingLoopPingSamples).toFixed(0)}ms`;
    pingSummaryDownEl.textContent = `${avg(pingLoopDownSamples).toFixed(1)} Mbps`;
    pingSummaryUpEl.textContent = `${avg(pingLoopUpSamples).toFixed(1)} Mbps`;
  }

  async function measurePingLoopDownload() {
    const t0 = performance.now();
    const res = await fetch(`/api/speedtest/download?bytes=${PING_LOOP_DOWNLOAD_BYTES}`, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    return mbps(buf.byteLength, (performance.now() - t0) / 1000);
  }

  function measurePingLoopUpload() {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/speedtest/upload");
      xhr.onload = () => resolve(mbps(PING_LOOP_UPLOAD_BYTES, (performance.now() - t0) / 1000));
      xhr.onerror = () => reject(new Error("upload failed"));
      xhr.send(pingLoopUploadBuffer);
    });
  }

  async function pingLoopStep() {
    pingLoopSeq++;
    try {
      const t0 = performance.now();
      const pingRes = await fetch("/api/speedtest/ping", { cache: "no-store" });
      const pingMs = performance.now() - t0;
      if (!pingRes.ok) throw new Error(`HTTP ${pingRes.status}`);

      const [downMbps, upMbps] = await Promise.all([measurePingLoopDownload(), measurePingLoopUpload()]);

      pingLoopPingSamples.push(pingMs);
      pingLoopDownSamples.push(downMbps);
      pingLoopUpSamples.push(upMbps);
      appendPingLogLine(pingMs, downMbps, upMbps, false);
    } catch (e) {
      appendPingLogLine(null, null, null, true);
    }
    renderPingStats();
  }

  async function runPingLoop() {
    while (pingLoopRunning) {
      await pingLoopStep();
      // A short pause between rounds — each round already takes real
      // time (the download/upload probes), this just avoids back-to-
      // back rounds with zero breathing room between them.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  pingLoopToggleBtn.addEventListener("click", () => {
    if (pingLoopRunning) {
      pingLoopRunning = false;
      pingLoopBtnLabelEl.textContent = t("pingtab.start");
      pingLoopToggleBtn.classList.remove("running");
      return;
    }
    pingLoopRunning = true;
    pingLoopPingSamples = [];
    pingLoopDownSamples = [];
    pingLoopUpSamples = [];
    pingLoopSeq = 0;
    pingLogEl.textContent = "";
    pingLogEl.hidden = true;
    pingLogEmptyEl.hidden = false;
    pingSummaryRowEl.hidden = true;
    pingLoopBtnLabelEl.textContent = t("pingtab.stop");
    pingLoopToggleBtn.classList.add("running");
    runPingLoop();
  });

  // Apply the stored/default language now that every section above
  // (ping loop, history charts, etc.) it touches is initialized —
  // applyLanguage() itself reloads the history charts with correctly-
  // localized labels; loadLatest() runs after it so the "last test"
  // message it sets is in the right language too.
  applyLanguage(getStoredLang() === "en" ? "en" : "fa");
  loadLatest();
})();
