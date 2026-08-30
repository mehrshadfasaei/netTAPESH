/**
 * Dashboard wiring: live traffic (WebSocket), historical charts (REST
 * fetch), connectivity status (polled), and alerts (polled).
 */
(function () {
  const CONNECTIVITY_POLL_MS = 10000;
  const ALERTS_POLL_MS = 15000;

  const connIndicator = document.getElementById("conn-indicator");
  const liveTableBody = document.querySelector("#liveTable tbody");
  const connectivityStatusEl = document.getElementById("connectivityStatus");
  const alertsListEl = document.getElementById("alertsList");

  // ---- Live traffic chart (rolling window of total active connections) ----
  const liveChartCtx = document.getElementById("liveChart").getContext("2d");
  const liveChart = new Chart(liveChartCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Total active connections",
          data: [],
          borderColor: "#4f8cff",
          backgroundColor: "rgba(79, 140, 255, 0.15)",
          tension: 0.3,
          fill: true,
          pointRadius: 0,
        },
      ],
    },
    options: chartOptions(),
  });
  const LIVE_WINDOW = 30;

  function chartOptions(extra) {
    return Object.assign(
      {
        responsive: true,
        animation: false,
        scales: {
          x: { ticks: { color: "#8b93a8" }, grid: { color: "#262f45" } },
          y: { ticks: { color: "#8b93a8" }, grid: { color: "#262f45" }, beginAtZero: true },
        },
        plugins: { legend: { labels: { color: "#e6e9f2" } } },
      },
      extra || {}
    );
  }

  function handleLiveMessage(msg) {
    if (msg.type !== "traffic_snapshot") return;

    // table
    liveTableBody.innerHTML = "";
    msg.processes.forEach((p) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.pid}</td><td>${p.connection_count}</td>`;
      liveTableBody.appendChild(row);
    });
    if (msg.processes.length === 0) {
      liveTableBody.innerHTML = `<tr><td colspan="3" style="color:#8b93a8">No active connections</td></tr>`;
    }

    // rolling chart
    const total = msg.processes.reduce((sum, p) => sum + p.connection_count, 0);
    const label = new Date().toLocaleTimeString();
    liveChart.data.labels.push(label);
    liveChart.data.datasets[0].data.push(total);
    if (liveChart.data.labels.length > LIVE_WINDOW) {
      liveChart.data.labels.shift();
      liveChart.data.datasets[0].data.shift();
    }
    liveChart.update("none");
  }

  const socket = new NetPulseSocket("/api/traffic/live", {
    onMessage: handleLiveMessage,
    onStatusChange: (status) => {
      connIndicator.textContent = status === "connected" ? "live" : "reconnecting…";
      connIndicator.className = "badge " + (status === "connected" ? "badge-up" : "badge-unknown");
    },
  });
  socket.connect();

  // ---- Traffic history chart ----
  const trafficHistoryCtx = document.getElementById("trafficHistoryChart").getContext("2d");
  const trafficHistoryChart = new Chart(trafficHistoryCtx, {
    type: "bar",
    data: { labels: [], datasets: [{ label: "Total connections observed", data: [], backgroundColor: "#4f8cff" }] },
    options: chartOptions(),
  });

  async function loadTrafficHistory(range) {
    const res = await fetch(`/api/traffic/history?range=${range}`);
    const data = await res.json();
    const top = data.processes.slice(0, 12);
    trafficHistoryChart.data.labels = top.map((p) => p.process_name);
    trafficHistoryChart.data.datasets[0].data = top.map((p) => p.total_connections);
    trafficHistoryChart.update();
  }

  // ---- Connectivity history chart ----
  const connectivityHistoryCtx = document.getElementById("connectivityHistoryChart").getContext("2d");
  const connectivityHistoryChart = new Chart(connectivityHistoryCtx, {
    type: "line",
    data: { datasets: [] },
    options: chartOptions({
      parsing: false,
      scales: {
        x: { type: "time", ticks: { color: "#8b93a8" }, grid: { color: "#262f45" } },
        y: { ticks: { color: "#8b93a8" }, grid: { color: "#262f45" }, title: { display: true, text: "ms", color: "#8b93a8" } },
      },
    }),
  });

  const HOST_COLORS = ["#4f8cff", "#33c07c", "#e2a33c", "#e5534b"];

  async function loadConnectivityHistory(range) {
    const res = await fetch(`/api/connectivity/history?range=${range}`);
    const data = await res.json();
    const byHost = {};
    data.samples.forEach((s) => {
      if (!byHost[s.target_host]) byHost[s.target_host] = [];
      byHost[s.target_host].push({ x: new Date(s.timestamp), y: s.latency_ms });
    });
    connectivityHistoryChart.data.datasets = Object.keys(byHost).map((host, i) => ({
      label: host,
      data: byHost[host],
      borderColor: HOST_COLORS[i % HOST_COLORS.length],
      pointRadius: 0,
      tension: 0.25,
      spanGaps: false, // gaps = outages (latency_ms null), keep them visible
    }));
    connectivityHistoryChart.update();
  }

  // ---- Range toggles ----
  document.querySelectorAll(".range-toggle").forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      const range = e.target.dataset.range;
      toggle.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target));
      if (toggle.dataset.target === "traffic") loadTrafficHistory(range);
      else loadConnectivityHistory(range);
    });
  });

  // ---- Connectivity status (polled) ----
  async function loadConnectivityStatus() {
    const res = await fetch("/api/connectivity/status");
    const data = await res.json();
    connectivityStatusEl.innerHTML = "";
    data.targets.forEach((t) => {
      const row = document.createElement("div");
      row.className = "status-row";
      const latencyText = t.latency_ms != null ? `${t.latency_ms.toFixed(0)} ms` : "—";
      row.innerHTML = `
        <span><span class="status-dot ${t.status}"></span>${escapeHtml(t.target_host)}</span>
        <span class="status-latency">${latencyText}</span>
      `;
      connectivityStatusEl.appendChild(row);
    });
    if (data.targets.length === 0) {
      connectivityStatusEl.innerHTML = `<div class="status-row">No targets configured</div>`;
    }
  }

  // ---- Alerts (polled) ----
  async function loadAlerts() {
    const res = await fetch("/api/alerts?limit=20");
    const data = await res.json();
    if (data.alerts.length === 0) {
      alertsListEl.innerHTML = `<li class="empty">No alerts yet.</li>`;
      return;
    }
    alertsListEl.innerHTML = data.alerts
      .map(
        (a) => `<li>
          <span>[${escapeHtml(a.type)}] ${escapeHtml(a.message)}</span>
          <span class="alert-time">${new Date(a.timestamp).toLocaleString()}</span>
        </li>`
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Initial load + polling ----
  loadTrafficHistory("day");
  loadConnectivityHistory("day");
  loadConnectivityStatus();
  loadAlerts();
  setInterval(loadConnectivityStatus, CONNECTIVITY_POLL_MS);
  setInterval(loadAlerts, ALERTS_POLL_MS);
})();
