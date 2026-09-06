"""Tests for the per-endpoint rate limits (slowapi) in
backend/api/routes.py. Uses the cheapest endpoint with the tightest limit
(/api/speedtest/client-info, 20/minute) so the test doesn't need to fire
thousands of requests to prove the limiter actually engages."""


def test_ping_allows_reasonable_burst(client):
    # 180/minute — a handful of requests should never trip it.
    for _ in range(10):
        resp = client.get("/api/speedtest/ping")
        assert resp.status_code == 200


def test_client_info_limit_engages(client):
    # 20/minute is the tightest limit in the app. ip-api.com calls are
    # skipped for loopback/private IPs (see speedtest_client_info), so
    # this stays fast and hits the limiter itself, not the network.
    last_status = None
    for _ in range(25):
        last_status = client.get("/api/speedtest/client-info").status_code
        if last_status == 429:
            break
    assert last_status == 429


def test_result_limit_engages(client):
    # 20/minute on /result too.
    payload = {"ping_ms": 1, "jitter_ms": 1, "download_mbps": 1, "upload_mbps": 1}
    last_status = None
    for _ in range(25):
        last_status = client.post("/api/speedtest/result", json=payload).status_code
        if last_status == 429:
            break
    assert last_status == 429
