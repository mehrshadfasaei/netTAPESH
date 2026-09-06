"""Tests for POST /api/speedtest/result — the metric validation added in
the security-hardening pass (see _validate_metric in backend/api/routes.py).
This endpoint has no auth by design, so it's the main place a malicious
POST body could corrupt the shared history chart for every visitor."""


def _post(client, **overrides):
    payload = {
        "ping_ms": 12.5,
        "jitter_ms": 1.2,
        "download_mbps": 87.3,
        "upload_mbps": 21.4,
    }
    payload.update(overrides)
    return client.post("/api/speedtest/result", json=payload)


def test_valid_result_is_saved(client):
    resp = _post(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "saved"
    assert isinstance(body["id"], int)


def test_null_metrics_are_allowed(client):
    resp = _post(client, ping_ms=None, jitter_ms=None, download_mbps=None, upload_mbps=None)
    assert resp.status_code == 200


def test_missing_keys_treated_as_null(client):
    resp = client.post("/api/speedtest/result", json={})
    assert resp.status_code == 200


def test_string_metric_rejected(client):
    resp = _post(client, download_mbps="<script>alert(1)</script>")
    assert resp.status_code == 400


def test_bool_metric_rejected(client):
    # bool is technically a subclass of int in Python — must be excluded
    # explicitly, or True/False would silently be stored as 1.0/0.0.
    resp = _post(client, ping_ms=True)
    assert resp.status_code == 400


def test_negative_metric_rejected(client):
    resp = _post(client, ping_ms=-1)
    assert resp.status_code == 400


def test_nan_metric_rejected(client):
    resp = client.post(
        "/api/speedtest/result",
        content='{"ping_ms": NaN, "jitter_ms": null, "download_mbps": null, "upload_mbps": null}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


def test_infinity_metric_rejected(client):
    resp = client.post(
        "/api/speedtest/result",
        content='{"ping_ms": Infinity, "jitter_ms": null, "download_mbps": null, "upload_mbps": null}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


def test_absurdly_large_metric_rejected(client):
    resp = _post(client, download_mbps=1e12)
    assert resp.status_code == 400


def test_saved_result_appears_in_latest(client):
    _post(client, download_mbps=123.4)
    resp = client.get("/api/speedtest/latest")
    assert resp.status_code == 200
    assert resp.json()["result"]["download_mbps"] == 123.4


def test_saved_result_appears_in_history(client):
    _post(client, upload_mbps=55.5)
    resp = client.get("/api/speedtest/history?range=day")
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert any(r["upload_mbps"] == 55.5 for r in results)
