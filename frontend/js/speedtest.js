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
    nowStampEl.textContent = new Date().toLocaleString("fa-IR", {
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
      label: "وب‌گردی",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18" stroke-linecap="round"/></svg>',
      score: ({ ping, download }) => scoreFromThresholds(download, [1, 5, 15, 30]) - (ping > 150 ? 1 : 0),
    },
    {
      key: "gaming",
      label: "گیم آنلاین",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M15.5 12h.01M18.5 10h.01" stroke-linecap="round"/></svg>',
      score: ({ ping, jitter }) => scoreFromThresholds(150 - ping, [0, 50, 90, 120]) - (jitter > 20 ? 1 : 0),
    },
    {
      key: "streaming",
      label: "استریم ویدیو",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="15" height="14" rx="2"/><path d="M17 8l5-3v14l-5-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      score: ({ download }) => scoreFromThresholds(download, [2, 5, 15, 25]),
    },
    {
      key: "videocall",
      label: "تماس تصویری",
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
    resultsTimestampEl.textContent = `تست در ${new Date().toLocaleString("fa-IR")} انجام شد`;

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
          <span class="results-quality-label">${cat.label}</span>
          <span class="results-quality-dots">${renderQualityDots(score)}</span>
        </div>
      `;
    }).join("");

    resultsOverlay.hidden = false;
  }

  resultsCloseBtn.addEventListener("click", () => {
    resultsOverlay.hidden = true;
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
    runBtn.disabled = true;
    rPing.textContent = "—";
    rJitter.textContent = "—";
    setDownloadDisplay(null);
    setUploadDisplay(null);
    resultMetaEl.textContent = "";
    resetGauge();

    try {
      testPhaseEl.textContent = "در حال تست پینگ…";
      const { ping_ms, jitter_ms } = await measurePing();
      rPing.textContent = ping_ms.toFixed(0);
      rJitter.textContent = jitter_ms.toFixed(1);

      setSpeedoDirection("down");
      testPhaseEl.textContent = "در حال تست دانلود…";
      const download_mbps = await measureDownload();
      setDownloadDisplay(download_mbps);

      resetGauge(); // fresh scale for upload — often a very different range than download
      setSpeedoDirection("up");
      testPhaseEl.textContent = "در حال تست آپلود…";
      const upload_mbps = await measureUpload();
      setUploadDisplay(upload_mbps);

      testPhaseEl.textContent = "";
      resultMetaEl.textContent = `تست در ${new Date().toLocaleString("fa-IR")} انجام شد`;

      const result = { ping_ms, jitter_ms, download_mbps, upload_mbps };
      await saveResult(result);
      loadHistory(document.querySelector('.range-toggle[data-target="history"] button.active').dataset.range);
      showResultsOverlay(result);
    } catch (e) {
      testPhaseEl.textContent = "";
      resultMetaEl.textContent = "خطا در اجرای تست — دوباره امتحان کن.";
      resetGauge();
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
          x: { ticks: { color: "#8b93a8" }, grid: { display: false } },
          y: {
            ticks: { color: "#8b93a8" },
            grid: { color: "#262f45" },
            beginAtZero: true,
            title: { display: true, text: "Mbps", color: "#8b93a8" },
          },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  const historyChartDown = makeHistoryBarChart("historyChartDown", "#4f8cff");
  const historyChartUp = makeHistoryBarChart("historyChartUp", "#33c07c");

  // Label format depends on range: a single day of tests only needs the
  // time; a week needs the date too, or same-time tests on different
  // days would look identical on the x-axis.
  function formatHistoryLabel(ts, range) {
    const d = new Date(ts);
    return range === "week"
      ? d.toLocaleString("fa-IR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString("fa-IR", { hour: "2-digit", minute: "2-digit" });
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
    resultMetaEl.textContent = `آخرین تست: ${new Date(r.timestamp).toLocaleString("fa-IR")}`;
  }

  resetGauge();
  loadLatest();
  loadHistory("day");

  // ---- Tab nav ----
  document.querySelectorAll(".tab-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-nav-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".page-tab").forEach((tab) => {
        tab.hidden = tab.id !== `tab-${btn.dataset.tab}`;
      });
    });
  });

  // ---- Continuous ping (like `ping -t`) ----
  // Loops /api/speedtest/ping — an endpoint that does nothing but reply
  // instantly — until the user stops it, logging each round trip like a
  // terminal ping. Negligible server load: no payload either way, just
  // an HTTP round trip, nowhere near the download/upload tests' bytes.
  const pingLoopToggleBtn = document.getElementById("pingLoopToggleBtn");
  const pingLogEl = document.getElementById("pingLog");
  const pingStatsEl = document.getElementById("pingStats");
  let pingLoopRunning = false;
  let pingLoopSamples = [];
  let pingLoopSeq = 0;

  function appendPingLogLine(text, isError) {
    const line = document.createElement("div");
    line.className = "ping-log-line" + (isError ? " error" : "");
    line.textContent = text;
    pingLogEl.appendChild(line);
    pingLogEl.scrollTop = pingLogEl.scrollHeight;
  }

  function renderPingStats() {
    if (pingLoopSamples.length === 0) {
      pingStatsEl.textContent = "";
      return;
    }
    const min = Math.min(...pingLoopSamples);
    const max = Math.max(...pingLoopSamples);
    const avg = pingLoopSamples.reduce((a, b) => a + b, 0) / pingLoopSamples.length;
    pingStatsEl.textContent =
      `Packets: Sent = ${pingLoopSeq}, Received = ${pingLoopSamples.length}\n` +
      `Approximate round trip times in milli-seconds:\n` +
      `    Minimum = ${min.toFixed(0)}ms, Maximum = ${max.toFixed(0)}ms, Average = ${avg.toFixed(1)}ms`;
  }

  async function pingLoopStep() {
    pingLoopSeq++;
    const t0 = performance.now();
    try {
      const res = await fetch("/api/speedtest/ping", { cache: "no-store" });
      const elapsed = performance.now() - t0;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pingLoopSamples.push(elapsed);
      appendPingLogLine(`Reply from ${location.host}: seq=${pingLoopSeq} time=${elapsed.toFixed(0)}ms`);
    } catch (e) {
      appendPingLogLine(`Request timed out (seq=${pingLoopSeq})`, true);
    }
    renderPingStats();
  }

  async function runPingLoop() {
    while (pingLoopRunning) {
      await pingLoopStep();
      // A short pause between pings, like real ping tools — otherwise
      // this would fire requests as fast as the network round trip
      // allows, which is unnecessary log spam more than useful signal.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  pingLoopToggleBtn.addEventListener("click", () => {
    if (pingLoopRunning) {
      pingLoopRunning = false;
      pingLoopToggleBtn.textContent = "شروع";
      pingLoopToggleBtn.classList.remove("running");
      return;
    }
    pingLoopRunning = true;
    pingLoopSamples = [];
    pingLoopSeq = 0;
    pingLogEl.textContent = "";
    pingStatsEl.textContent = "";
    pingLoopToggleBtn.textContent = "توقف";
    pingLoopToggleBtn.classList.add("running");
    runPingLoop();
  });
})();
