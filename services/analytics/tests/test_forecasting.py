"""Forecast suitability, validation split and metric tests."""
import math

import numpy as np
import pytest

from app.forecasting import ForecastError, run_forecast


def trend_series(n=40, slope=25, base=1000):
    return [
        {"date": f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}", "revenue": base + i * slope}
        for i in range(n)
    ]


def test_forecast_shape_and_intervals():
    result = run_forecast(trend_series(), "revenue", "date", horizon=10)
    assert result["horizon"] == 10
    assert len(result["forecast"]) == 10
    assert len(result["history"]) == 40
    for point in result["forecast"]:
        assert point["lower"] <= point["predicted"] <= point["upper"]


def test_includes_naive_baseline_comparison():
    result = run_forecast(trend_series(), "revenue", "date", horizon=6)
    types = {m["modelType"] for m in result["modelComparison"]}
    assert "baseline_naive" in types
    assert "baselineMetrics" in result
    assert sum(1 for m in result["modelComparison"] if m["selected"]) == 1


def test_clean_linear_trend_beats_baseline():
    result = run_forecast(trend_series(), "revenue", "date", horizon=5)
    assert result["modelType"] in {"linear", "gradient_boosting"}
    assert result["beatsBaseline"] is True
    assert result["metrics"]["rmse"] < result["baselineMetrics"]["rmse"]


def test_extrapolates_upward_trend():
    result = run_forecast(trend_series(), "revenue", "date", horizon=5)
    last_history = result["history"][-1]["actual"]
    assert result["forecast"][0]["predicted"] > last_history * 0.95


def test_rejects_insufficient_history():
    with pytest.raises(ForecastError) as exc:
        run_forecast(trend_series(n=6), "revenue", "date", horizon=3)
    assert exc.value.code == "INSUFFICIENT_HISTORY"


def test_rejects_non_numeric_target():
    rows = [{"date": "2026-01-01", "label": "alpha"} for _ in range(30)]
    with pytest.raises(ForecastError) as exc:
        run_forecast(rows, "label", "date", horizon=3)
    assert exc.value.code == "TARGET_NOT_NUMERIC"


def test_rejects_unparseable_time_field():
    rows = [{"when": "not a date", "value": i} for i in range(30)]
    with pytest.raises(ForecastError) as exc:
        run_forecast(rows, "value", "when", horizon=3)
    assert exc.value.code == "TIME_NOT_PARSEABLE"


def test_rejects_invalid_horizon():
    for horizon in (0, -3, 500):
        with pytest.raises(ForecastError) as exc:
            run_forecast(trend_series(), "revenue", "date", horizon=horizon)
        assert exc.value.code == "INVALID_HORIZON"


def test_noisy_series_warns_rather_than_claiming_certainty():
    rng = np.random.default_rng(7)
    rows = [
        {"period": f"2026-01-{i+1:02d}", "value": float(rng.normal(100, 40))}
        for i in range(24)
    ]
    result = run_forecast(rows, "value", "period", horizon=4)
    assert result["disclaimer"]
    assert len(result["warnings"]) >= 1


def test_explicit_baseline_model_is_honoured():
    result = run_forecast(trend_series(), "revenue", "date", horizon=4, model_type="baseline")
    assert result["modelType"] == "baseline_naive"
    values = {p["predicted"] for p in result["forecast"]}
    assert len(values) == 1  # naive repeats the last value


def test_monthly_cadence_is_detected():
    rows = [{"month": f"2026-{m:02d}-01", "value": 100 + m * 3} for m in range(1, 13)]
    result = run_forecast(rows, "value", "month", horizon=3)
    periods = [p["period"] for p in result["forecast"]]
    assert periods[0].startswith("2027-01"), periods


def test_handles_missing_values_in_target():
    rows = [{"date": f"2026-01-{i+1:02d}", "value": (None if i % 7 == 0 else 100 + i * 5)} for i in range(35)]
    result = run_forecast(rows, "value", "date", horizon=3)
    assert all(p["predicted"] is not None for p in result["forecast"])


def test_metrics_are_finite():
    result = run_forecast(trend_series(), "revenue", "date", horizon=3)
    for key in ("mae", "rmse", "mape", "r2"):
        assert math.isfinite(result["metrics"][key])
