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
  const rDown = document.getElementById("rDown");
  const rUp = document.getElementById("rUp");
  const rDownUnit = document.getElementById("rDownUnit");
  const rUpUnit = document.getElementById("rUpUnit");
  const unitToggle = document.getElementById("unitToggle");
  const resultMetaEl = document.getElementById("resultMeta");
  const gaugeRing = document.getElementById("gaugeRing");
  const gaugeLiveValue = document.getElementById("gaugeLiveValue");

  // ---- Gauge (the colored ring around the run button) ----
  // Auto-scales like a real speedometer: the "full scale" jumps to the
  // next tier once the live value gets close to the current one, rather
  // than a fixed max that either wastes most of the ring on slow
  // connections or pins at 100% for fast ones.
  const GAUGE_TIERS = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000];
  let gaugeTierMax = GAUGE_TIERS[0];

  function resetGauge() {
    gaugeTierMax = GAUGE_TIERS[0];
    gaugeRing.style.setProperty("--pct", "0");
    gaugeLiveValue.textContent = "";
    runBtnLabel.style.display = "";
  }

  function updateGauge(mbpsValue) {
    while (mbpsValue > gaugeTierMax * 0.9 && gaugeTierMax < GAUGE_TIERS[GAUGE_TIERS.length - 1]) {
      const next = GAUGE_TIERS[GAUGE_TIERS.indexOf(gaugeTierMax) + 1];
      if (!next) break;
      gaugeTierMax = next;
    }
    const pct = Math.max(0, Math.min(mbpsValue / gaugeTierMax, 1));
    gaugeRing.style.setProperty("--pct", String(pct));
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
  // (not one giant body — keeps browser memory bounded) until aborted ----
  const UPLOAD_CHUNK_BYTES = 4_000_000;
  const _uploadBuffer = new Uint8Array(UPLOAD_CHUNK_BYTES);

  async function uploadLane(signal, onBytes) {
    try {
      while (!signal.aborted) {
        await fetch("/api/speedtest/upload", {
          method: "POST",
          body: _uploadBuffer,
          signal,
          cache: "no-store",
        });
        onBytes(UPLOAD_CHUNK_BYTES);
      }
    } catch (e) {
      // aborted mid-chunk — that partial chunk is simply not counted
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
    setDownloadDisplay(null);
    setUploadDisplay(null);
    resultMetaEl.textContent = "";
    resetGauge();

    try {
      testPhaseEl.textContent = "در حال تست پینگ…";
      const { ping_ms, jitter_ms } = await measurePing();
      rPing.textContent = ping_ms.toFixed(0);

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

  // ---- History chart ----
  const historyCtx = document.getElementById("historyChart").getContext("2d");
  const historyChart = new Chart(historyCtx, {
    type: "line",
    data: {
      datasets: [
        { label: "دانلود (Mbps)", data: [], borderColor: "#4f8cff", pointRadius: 3, tension: 0.25 },
        { label: "آپلود (Mbps)", data: [], borderColor: "#33c07c", pointRadius: 3, tension: 0.25 },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      scales: {
        x: { type: "time", ticks: { color: "#8b93a8" }, grid: { color: "#262f45" } },
        y: {
          ticks: { color: "#8b93a8" },
          grid: { color: "#262f45" },
          beginAtZero: true,
          title: { display: true, text: "Mbps", color: "#8b93a8" },
        },
      },
      plugins: { legend: { labels: { color: "#e6e9f2" } } },
    },
  });

  async function loadHistory(range) {
    const res = await fetch(`/api/speedtest/history?range=${range}`);
    const data = await res.json();
    const download = data.results.filter((r) => r.download_mbps != null).map((r) => ({ x: new Date(r.timestamp), y: r.download_mbps }));
    const upload = data.results.filter((r) => r.upload_mbps != null).map((r) => ({ x: new Date(r.timestamp), y: r.upload_mbps }));
    historyChart.data.datasets[0].data = download;
    historyChart.data.datasets[1].data = upload;
    historyChart.update();
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
    if (r.download_mbps != null) setDownloadDisplay(r.download_mbps);
    if (r.upload_mbps != null) setUploadDisplay(r.upload_mbps);
    resultMetaEl.textContent = `آخرین تست: ${new Date(r.timestamp).toLocaleString("fa-IR")}`;
  }

  resetGauge();
  loadLatest();
  loadHistory("day");
})();
