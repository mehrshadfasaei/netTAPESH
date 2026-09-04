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
  const gaugeRing = document.getElementById("gaugeRing");
  const gaugeLiveValue = document.getElementById("gaugeLiveValue");
  const nowStampEl = document.getElementById("nowStamp");
  const ispNameEl = document.getElementById("ispName");
  const locationNameEl = document.getElementById("locationName");

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
  async function loadClientInfo() {
    try {
      const res = await fetch("/api/speedtest/client-info");
      const data = await res.json();
      ispNameEl.textContent = data.isp || "—";
      locationNameEl.textContent = data.location || "—";
    } catch (e) {
      // best-effort — leave the "—" placeholders
    }
  }
  loadClientInfo();

  // ---- Gauge (the colored ring around the run button) ----
  // A fixed-max LOGARITHMIC scale, not a tiered linear one: an earlier
  // version re-tiered its "full scale" (10 -> 25 -> 50 -> ... Mbps) as
  // the live value approached the current tier's max, which made the
  // ring visibly snap backward every time it re-tiered (e.g. 85% -> 37%
  // the instant the scale jumped from the 10 to the 25 Mbps tier) —
  // jarring, and exactly what read as "buggy". A single fixed max with a
  // log mapping is monotonic: the ring only ever fills forward as speed
  // increases, never jumps back, while still giving slow connections
  // (a few Mbps) a readable amount of the ring instead of being crushed
  // near zero the way a fixed LINEAR scale up to 2000 Mbps would.
  const GAUGE_MAX_MBPS = 2000;
  const GAUGE_LOG_MAX = Math.log10(GAUGE_MAX_MBPS + 1);

  function speedToPct(mbpsValue) {
    if (mbpsValue <= 0) return 0;
    return Math.max(0, Math.min(Math.log10(mbpsValue + 1) / GAUGE_LOG_MAX, 1));
  }

  function resetGauge() {
    gaugeRing.style.setProperty("--pct", "0");
    gaugeLiveValue.textContent = "";
    runBtnLabel.style.display = "";
  }

  function updateGauge(mbpsValue) {
    gaugeRing.style.setProperty("--pct", String(speedToPct(mbpsValue)));
    gaugeLiveValue.textContent = mbpsValue.toFixed(1);
    runBtnLabel.style.display = "none";
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

      testPhaseEl.textContent = "در حال تست دانلود…";
      const download_mbps = await measureDownload();
      setDownloadDisplay(download_mbps);

      resetGauge(); // fresh scale for upload — often a very different range than download
      testPhaseEl.textContent = "در حال تست آپلود…";
      const upload_mbps = await measureUpload();
      setUploadDisplay(upload_mbps);

      testPhaseEl.textContent = "";
      runBtnLabel.style.display = "";
      gaugeLiveValue.textContent = "";
      resultMetaEl.textContent = `تست در ${new Date().toLocaleString("fa-IR")} انجام شد`;

      const result = { ping_ms, jitter_ms, download_mbps, upload_mbps };
      await saveResult(result);
      loadHistory(document.querySelector('.range-toggle[data-target="history"] button.active').dataset.range);
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
})();
