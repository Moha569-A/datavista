"""HTTP contract tests for the internal analytics service."""
import base64
import os

import pytest
from fastapi.testclient import TestClient

TOKEN = os.getenv("ANALYTICS_SERVICE_TOKEN", "dev-analytics-token")

from app.main import app  # noqa: E402

client = TestClient(app)
AUTH = {"x-service-token": TOKEN}


def test_health_is_open():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["service"] == "analytics"


def test_requests_require_service_token():
    res = client.post("/query", json={})
    assert res.status_code == 401


def test_profile_returns_columns_and_rows():
    csv = "region,revenue\nNorth,100\nSouth,250\n"
    res = client.post(
        "/profile",
        headers=AUTH,
        json={"filename": "d.csv", "contentBase64": base64.b64encode(csv.encode()).decode()},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["rowCount"] == 2
    assert body["columns"][0]["name"] == "region"


def test_profile_error_uses_code_and_message():
    csv = "a,b\n"
    res = client.post(
        "/profile",
        headers=AUTH,
        json={"filename": "d.csv", "contentBase64": base64.b64encode(csv.encode()).decode()},
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "NO_ROWS"
    assert "no data rows" in detail["message"].lower()


def test_query_contract():
    res = client.post(
        "/query",
        headers=AUTH,
        json={
            "rows": [{"r": "N", "v": 10}, {"r": "N", "v": 5}, {"r": "S", "v": 7}],
            "columns": [{"name": "r", "type": "category"}, {"name": "v", "type": "number"}],
            "chartType": "bar",
            "xField": "r",
            "yField": "v",
            "aggregation": "sum",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert {d["label"]: d["value"] for d in body["data"]} == {"N": 15, "S": 7}


def test_query_rejects_unknown_column():
    res = client.post(
        "/query",
        headers=AUTH,
        json={
            "rows": [{"r": "N", "v": 1}],
            "columns": [{"name": "r", "type": "category"}],
            "chartType": "bar",
            "xField": "ghost",
            "yField": "v",
            "aggregation": "sum",
        },
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "UNKNOWN_FIELD"


def test_forecast_contract():
    rows = [{"date": f"2026-01-{i+1:02d}", "v": 100 + i * 4} for i in range(30)]
    res = client.post(
        "/forecast",
        headers=AUTH,
        json={"rows": rows, "targetColumn": "v", "timeField": "date", "horizon": 5},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["forecast"]) == 5
    assert "rmse" in body["metrics"]
    assert body["disclaimer"]


def test_forecast_rejects_short_history():
    rows = [{"date": f"2026-01-0{i+1}", "v": i} for i in range(5)]
    res = client.post(
        "/forecast",
        headers=AUTH,
        json={"rows": rows, "targetColumn": "v", "timeField": "date", "horizon": 3},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "INSUFFICIENT_HISTORY"
