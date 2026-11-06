import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from main import app, database


def test_missing_database_configuration(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 503


def test_rejects_invalid_case():
    app.dependency_overrides[database] = lambda: None
    try:
        with TestClient(app) as client:
            response = client.post("/api/cases", json={
                "company_name": "Unternehmen", "predicted_code": "A", "confidence": 1.2
            })
            assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL fehlt")
def test_case_and_decision_persist(monkeypatch):
    import psycopg

    url = os.environ["TEST_DATABASE_URL"]
    monkeypatch.setenv("DATABASE_URL", url)
    with psycopg.connect(url) as connection:
        connection.execute(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
    with TestClient(app) as client:
        assert client.get("/api/health").json() == {"status": "ok"}
        case = client.post("/api/cases", json={
            "company_name": "Testunternehmen", "predicted_code": "A", "confidence": 0.8
        })
        assert case.status_code == 201
        case_id = case.json()["id"]
        try:
            decision = client.post(f"/api/cases/{case_id}/decisions", json={
                "reviewer": "Testperson", "decision": "A"
            })
            assert decision.status_code == 201
            assert client.get(f"/api/cases/{case_id}/decisions").json()[0]["decision"] == "A"
            assert any(item["id"] == case_id for item in client.get("/api/cases").json())
            assert client.post("/api/cases/0/decisions", json={
                "reviewer": "Testperson", "decision": "A"
            }).status_code == 404
        finally:
            with psycopg.connect(url) as connection:
                connection.execute("DELETE FROM decisions WHERE case_id = %s", (case_id,))
                connection.execute("DELETE FROM cases WHERE id = %s", (case_id,))
