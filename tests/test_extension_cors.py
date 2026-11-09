import pytest
from starlette.testclient import TestClient
from backend.api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_cors_chrome_extension_preflight(client):
    origin = "chrome-extension://nmgcefdhjpjefhgcpocffdlibknajbmj"
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
    }
    response = client.options("/api/library", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert "POST" in response.headers.get("access-control-allow-methods", "")


def test_cors_firefox_extension_preflight(client):
    origin = "moz-extension://4b4b4b4b-4b4b-4b4b-4b4b-4b4b4b4b4b4b"
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
    }
    response = client.options("/api/library", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
