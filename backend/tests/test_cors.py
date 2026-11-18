import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    settings = Settings(_env_file=None)
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    return TestClient(create_app())


@pytest.mark.parametrize(
    "origin", ["https://localhost", "capacitor://localhost", "http://localhost:5173"]
)
def test_app_origins_can_post_json(client: TestClient, origin: str) -> None:
    response = client.options(
        "/api/routes",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "POST" in response.headers["access-control-allow-methods"]


def test_app_response_has_cors_header(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "https://localhost"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://localhost"


def test_unlisted_origin_is_not_allowed(client: TestClient) -> None:
    response = client.options(
        "/api/routes",
        headers={
            "Origin": "https://unlisted.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_configured_origins_replace_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", '["https://custom.example.com"]')
    settings = Settings(_env_file=None)
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    client = TestClient(create_app())

    for origin, expected in [
        ("https://custom.example.com", 200),
        ("https://localhost", 400),
    ]:
        response = client.options(
            "/api/routes",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
        )
        assert response.status_code == expected
