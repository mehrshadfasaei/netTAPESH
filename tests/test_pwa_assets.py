"""Tests that the PWA assets (manifest, service worker, icons) are
actually served — these are static files under frontend/, handled by
FastAPI's StaticFiles mount rather than any custom route, but a typo'd
filename or missing icon would silently break "Add to Home Screen"
without any of the other tests noticing."""


def test_manifest_is_served(client):
    resp = client.get("/manifest.json")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "netTAPESH - تست سرعت اینترنت"
    assert data["start_url"] == "/"
    assert len(data["icons"]) >= 2


def test_manifest_icons_are_all_reachable(client):
    manifest = client.get("/manifest.json").json()
    for icon in manifest["icons"]:
        resp = client.get(icon["src"])
        assert resp.status_code == 200, f"{icon['src']} not served"
        assert resp.headers["content-type"].startswith("image/")


def test_service_worker_is_served(client):
    resp = client.get("/sw.js")
    assert resp.status_code == 200
    # Never allowed to touch /api/* — a cached speed-test response
    # would silently corrupt every measurement (see sw.js's own
    # comment). Assert the actual guard is still there, not just that
    # the file exists.
    assert "/api/" in resp.text


def test_apple_touch_icon_is_served(client):
    resp = client.get("/icons/icon-192.png")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
