/**
 * Thin WebSocket wrapper: connects to /api/traffic/live, auto-reconnects
 * with backoff, and hands parsed JSON messages to whatever callback the
 * dashboard registers.
 */
class NetPulseSocket {
  constructor(path, { onMessage, onStatusChange } = {}) {
    this.path = path;
    this.onMessage = onMessage || (() => {});
    this.onStatusChange = onStatusChange || (() => {});
    this._retryDelayMs = 1000;
    this._maxRetryDelayMs = 15000;
    this._socket = null;
    this._closedByUser = false;
  }

  connect() {
    this._closedByUser = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}${this.path}`;
    this._socket = new WebSocket(url);

    this._socket.onopen = () => {
      this._retryDelayMs = 1000;
      this.onStatusChange("connected");
    };

    this._socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onMessage(data);
      } catch (err) {
        console.error("NetPulseSocket: failed to parse message", err);
      }
    };

    this._socket.onclose = () => {
      this.onStatusChange("disconnected");
      if (!this._closedByUser) this._scheduleReconnect();
    };

    this._socket.onerror = () => {
      this._socket.close();
    };
  }

  _scheduleReconnect() {
    setTimeout(() => this.connect(), this._retryDelayMs);
    this._retryDelayMs = Math.min(this._retryDelayMs * 1.5, this._maxRetryDelayMs);
  }

  close() {
    this._closedByUser = true;
    if (this._socket) this._socket.close();
  }
}
