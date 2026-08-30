/**
 * Client-side speed test: pings, downloads, and uploads against this
 * server's own /api/speedtest/* endpoints (see backend/api/routes.py) —
 * all the actual timing happens here in the browser, the server just
 * sources/sinks bytes.
 */
(function () {
  const PING_SAMPLES = 10;
  const DOWNLOAD_BYTES = 25_000_000;
  const UPLOAD_BYTES = 15_000_000;

  const runBtn = document.getElementById("runBtn");
  const runBtnLabel = document.getElementById("runBtnLabel");
  const testPhaseEl = document.getElementById("testPhase");
  const rPing = document.getElementById("rPing");
  const rDown = document.getElementById("rDown");
  const rUp = document.getElementById("rUp");
  const resultMetaEl = document.getElementById("resultMeta");

  function mbps(bytes, seconds) {
    if (seconds <= 0) return 0;
    return (bytes * 8) / (seconds * 1_000_000);
  }

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

  async function measureDownload() {
    const t0 = performance.now();
    const res = await fetch(`/api/speedtest/download?bytes=${DOWNLOAD_BYTES}`, { cache: "no-store" });
    const reader = res.body.getReader();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      const elapsed = (performance.now() - t0) / 1000;
      rDown.textContent = mbps(received, elapsed).toFixed(1);
    }
    const elapsed = (performance.now() - t0) / 1000;
    return mbps(received, elapsed);
  }

  function measureUpload() {
    return new Promise((resolve, reject) => {
      const data = new Uint8Array(UPLOAD_BYTES);
      const xhr = new XMLHttpRequest();
      const t0 = performance.now();
      xhr.open("POST", "/api/speedtest/upload");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const elapsed = (performance.now() - t0) / 1000;
        rUp.textContent = mbps(e.loaded, elapsed).toFixed(1);
      };
      xhr.onload = () => {
        const elapsed = (performance.now() - t0) / 1000;
        resolve(mbps(UPLOAD_BYTES, elapsed));
      };
      xhr.onerror = () => reject(new Error("upload failed"));
      xhr.send(data);
    });
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
    rDown.textContent = "—";
    rUp.textContent = "—";
    resultMetaEl.textContent = "";

    try {
      testPhaseEl.textContent = "در حال تست پینگ…";
      const { ping_ms, jitter_ms } = await measurePing();
      rPing.textContent = ping_ms.toFixed(0);

      testPhaseEl.textContent = "در حال تست دانلود…";
      const download_mbps = await measureDownload();
      rDown.textContent = download_mbps.toFixed(1);

      testPhaseEl.textContent = "در حال تست آپلود…";
      const upload_mbps = await measureUpload();
      rUp.textContent = upload_mbps.toFixed(1);

      testPhaseEl.textContent = "";
      resultMetaEl.textContent = `تست در ${new Date().toLocaleString("fa-IR")} انجام شد`;

      const result = { ping_ms, jitter_ms, download_mbps, upload_mbps };
      await saveResult(result);
      loadHistory(document.querySelector('.range-toggle[data-target="history"] button.active').dataset.range);
    } catch (e) {
      testPhaseEl.textContent = "";
      resultMetaEl.textContent = "خطا در اجرای تست — دوباره امتحان کن.";
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
    if (r.download_mbps != null) rDown.textContent = r.download_mbps.toFixed(1);
    if (r.upload_mbps != null) rUp.textContent = r.upload_mbps.toFixed(1);
    resultMetaEl.textContent = `آخرین تست: ${new Date(r.timestamp).toLocaleString("fa-IR")}`;
  }

  loadLatest();
  loadHistory("day");
})();
