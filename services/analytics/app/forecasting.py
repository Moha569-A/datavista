"""Forecasting service.

Suitability checks -> chronological train/validation split -> baseline vs
candidate model comparison -> metrics + prediction intervals.

Rules enforced (TRD 4.4 / PRD FR-06):
* time series only: rows are ordered by the time field, never shuffled;
* the last `validation_periods` observations are held out (no random split);
* a naive/seasonal-naive baseline is always computed so a sophisticated model
  cannot silently beat a trivial one;
* sufficient history is required before any model is trained;
* results carry explicit warnings so the UI can present estimates as estimates.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

MIN_HISTORY = 12
MAX_HORIZON = 90
MAX_SERIES_POINTS = 5000


class ForecastError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)


def build_series(rows: list[dict], target_column: str, time_field: str | None) -> pd.DataFrame:
    if not rows:
        raise ForecastError("EMPTY_DATASET", "The dataset contains no rows.")
    df = pd.DataFrame(rows)
    if target_column not in df.columns:
        raise ForecastError("UNKNOWN_FIELD", f"Target column '{target_column}' is not part of this dataset.")

    df["__target"] = pd.to_numeric(
        df[target_column].astype(str).str.replace(",", "", regex=False), errors="coerce"
    )
    numeric_ratio = float(df["__target"].notna().mean())
    if numeric_ratio < 0.8:
        raise ForecastError(
            "TARGET_NOT_NUMERIC",
            f"'{target_column}' is only {numeric_ratio * 100:.0f}% numeric. Forecasting needs a numeric target.",
            {"numericRatio": round(numeric_ratio, 3), "suggestion": "Choose a numeric column such as revenue or quantity."},
        )

    if time_field:
        if time_field not in df.columns:
            raise ForecastError("UNKNOWN_FIELD", f"Time field '{time_field}' is not part of this dataset.")
        df["__time"] = pd.to_datetime(df[time_field], errors="coerce", format="mixed")
        parsed_ratio = float(df["__time"].notna().mean())
        if parsed_ratio < 0.8:
            raise ForecastError(
                "TIME_NOT_PARSEABLE",
                f"'{time_field}' could not be interpreted as dates for {100 - parsed_ratio * 100:.0f}% of rows.",
                {"parsedRatio": round(parsed_ratio, 3)},
            )
        df = df.dropna(subset=["__time", "__target"]).sort_values("__time")
        series = df.groupby(df["__time"].dt.to_period("D"))["__target"].mean().reset_index()
        series.columns = ["ds", "y"]
        series["ds"] = series["ds"].dt.to_timestamp()
    else:
        df = df.dropna(subset=["__target"]).reset_index(drop=True)
        df["__time"] = pd.date_range("2000-01-01", periods=len(df), freq="D")
        series = df[["__time", "__target"]].rename(columns={"__time": "ds", "__target": "y"})

    if len(series) > MAX_SERIES_POINTS:
        # Downsample evenly, keeping the most recent points (they matter most).
        series = series.tail(MAX_SERIES_POINTS).reset_index(drop=True)
    return series.reset_index(drop=True)


def _metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    mask = ~(np.isnan(actual) | np.isnan(predicted))
    actual, predicted = actual[mask], predicted[mask]
    if len(actual) == 0:
        return {"mae": 0.0, "rmse": 0.0, "mape": 0.0, "r2": 0.0, "n": 0}
    errors = actual - predicted
    mae = float(np.mean(np.abs(errors)))
    rmse = float(np.sqrt(np.mean(errors**2)))
    nonzero = actual != 0
    mape = float(np.mean(np.abs(errors[nonzero] / actual[nonzero])) * 100) if nonzero.any() else 0.0
    ss_res = float(np.sum(errors**2))
    ss_tot = float(np.sum((actual - actual.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "mape": round(mape, 2),
        "r2": round(r2, 4),
        "n": int(len(actual)),
    }


def _fit_linear(t: np.ndarray, y: np.ndarray):
    coefs = np.polyfit(t, y, 1)
    return lambda x: np.polyval(coefs, x), coefs


def _fit_seasonal_naive(y: np.ndarray, season: int):
    def predict(x: np.ndarray) -> np.ndarray:
        out = []
        for xi in x:
            out.append(y[int(xi) - season] if int(xi) - season >= 0 else float(np.mean(y)))
        return np.array(out, dtype=float)

    return predict


def run_forecast(
    rows: list[dict],
    target_column: str,
    time_field: str | None = None,
    horizon: int = 12,
    model_type: str = "auto",
) -> dict[str, Any]:
    if not isinstance(horizon, int) or horizon < 1 or horizon > MAX_HORIZON:
        raise ForecastError("INVALID_HORIZON", f"Forecast horizon must be between 1 and {MAX_HORIZON} periods.")
    if model_type not in {"auto", "linear", "seasonal_naive", "baseline"}:
        raise ForecastError("INVALID_MODEL", f"Model '{model_type}' is not available.")

    series = build_series(rows, target_column, time_field)
    n = len(series)
    warnings: list[str] = []

    if n < MIN_HISTORY:
        raise ForecastError(
            "INSUFFICIENT_HISTORY",
            f"At least {MIN_HISTORY} data points are required to validate a forecast; this dataset yields {n}.",
            {"pointsAvailable": n, "pointsRequired": MIN_HISTORY},
        )
    if n < 24:
        warnings.append(
            f"Only {n} observations are available. Treat this forecast as indicative, not conclusive."
        )

    y = series["y"].to_numpy(dtype=float)
    t = np.arange(n, dtype=float)

    validation_periods = max(3, min(n // 5, 12))
    if n - validation_periods < MIN_HISTORY // 2:
        raise ForecastError("INSUFFICIENT_HISTORY", "Not enough history remains after holding out a validation window.")

    train_y, valid_y = y[:-validation_periods], y[-validation_periods:]
    train_t = t[:-validation_periods]
    valid_t = t[-validation_periods:]
    train_series = series.iloc[:-validation_periods]

    # --- candidate models ---------------------------------------------------
    candidates: dict[str, dict[str, Any]] = {}

    # Baseline: naive (last value carried forward). Always evaluated.
    naive_pred = np.full(len(valid_y), train_y[-1], dtype=float)
    candidates["baseline_naive"] = {
        "modelType": "baseline_naive",
        "label": "Naive (last value)",
        "validation": _metrics(valid_y, naive_pred),
        "predict": (lambda x: np.full(len(x), float(train_y[-1]))),
    }

    # Linear trend on time index.
    try:
        lin_predict, _ = _fit_linear(train_t, train_y)
        candidates["linear"] = {
            "modelType": "linear",
            "label": "Linear trend",
            "validation": _metrics(valid_y, lin_predict(valid_t)),
            "predict": lin_predict,
        }
    except Exception:
        pass

    # Seasonal naive (weekly seasonality when a daily time field is present).
    if time_field and n >= 14:
        season = 7
        try:
            sn = _fit_seasonal_naive(train_y, season)
            candidates["seasonal_naive"] = {
                "modelType": "seasonal_naive",
                "label": "Seasonal naive (7 periods)",
                "validation": _metrics(valid_y, sn(valid_t)),
                "predict": sn,
            }
        except Exception:
            pass

    # Gradient boosting on lag features, when enough data exists.
    if n >= 30:
        try:
            from sklearn.ensemble import GradientBoostingRegressor

            lags = 7
            X, Y = [], []
            for i in range(lags, len(train_y)):
                X.append(train_y[i - lags : i])
                Y.append(train_y[i])
            if len(X) >= 15:
                model = GradientBoostingRegressor(random_state=42, n_estimators=120, max_depth=2)
                model.fit(np.array(X), np.array(Y))
                history = list(train_y)

                def gb_predict(x, model=model, lags=lags, history=history):
                    hist = list(history)
                    out = []
                    for _ in x:
                        out.append(float(model.predict(np.array([hist[-lags:]]))[0]))
                        hist.append(out[-1])
                    return np.array(out)

                def gb_eval():
                    hist = list(train_y)
                    preds = []
                    for _ in range(len(valid_y)):
                        p = float(model.predict(np.array([hist[-lags:]]))[0])
                        preds.append(p)
                        hist.append(valid_y[len(preds) - 1])
                    return np.array(preds)

                candidates["gradient_boosting"] = {
                    "modelType": "gradient_boosting",
                    "label": "Gradient boosting (lag features)",
                    "validation": _metrics(valid_y, gb_eval()),
                    "predict": gb_predict,
                }
        except Exception:
            warnings.append("Gradient boosting model could not be trained; comparison skipped.")

    if not candidates:
        raise ForecastError("MODEL_FAILED", "No forecast model could be fitted to this data.")

    # --- select model -------------------------------------------------------
    baseline_rmse_for_selection = candidates["baseline_naive"]["validation"]["rmse"]

    if model_type == "auto":
        # Occam's razor: a candidate must beat the naive baseline by a
        # meaningful margin (>2% lower RMSE) to displace it. This stops a
        # flexible model from being presented as "best" when it is effectively
        # fitting noise on a short series.
        viable = {
            key: meta
            for key, meta in candidates.items()
            if meta["validation"]["n"]
            and (
                key == "baseline_naive"
                or meta["validation"]["rmse"] < baseline_rmse_for_selection * 0.98
            )
        }
        if not viable:
            viable = {"baseline_naive": candidates["baseline_naive"]}
        chosen_key = min(viable, key=lambda k: viable[k]["validation"]["rmse"])
    else:
        chosen_key = {"baseline": "baseline_naive", "linear": "linear", "seasonal_naive": "seasonal_naive"}.get(
            model_type, "baseline_naive"
        )
        if chosen_key not in candidates:
            raise ForecastError(
                "MODEL_UNAVAILABLE",
                f"The '{model_type}' model needs more history or a time field to train.",
            )

    chosen = candidates[chosen_key]
    baseline_rmse = candidates["baseline_naive"]["validation"]["rmse"]
    chosen_rmse = chosen["validation"]["rmse"]
    if chosen["validation"].get("r2", 0) < 0:
        warnings.append(
            "On the validation window the model explains less variance than a simple average "
            "(negative R²). Treat these predictions as directional only."
        )
    if chosen_key == "baseline_naive" and len(candidates) > 1:
        warnings.append(
            "No candidate model beat the naive baseline on the validation window, so the "
            "baseline forecast is shown. The series may be too noisy or too short to model reliably."
        )
    elif chosen_key != "baseline_naive" and chosen_rmse >= baseline_rmse:
        warnings.append(
            "The selected model did not beat the naive baseline on the validation window. "
            "Consider treating the naive forecast as the more defensible estimate."
        )

    # --- refit on the full history and forecast ----------------------------
    full_t = t
    future_t = np.arange(n, n + horizon, dtype=float)

    if chosen_key == "linear":
        predict_full, coefs = _fit_linear(full_t, y)
        predictions = predict_full(future_t)
        slope = float(coefs[0])
        direction = "increasing" if slope > 0 else ("decreasing" if slope < 0 else "flat")
        warnings.append(f"The linear trend is {direction} by about {_num(abs(slope))} units per period.")
    elif chosen_key == "seasonal_naive":
        predict_full = _fit_seasonal_naive(y, 7)
        predictions = predict_full(future_t)
    elif chosen_key == "gradient_boosting":
        # Refit lag model on all available data, then roll forward.
        from sklearn.ensemble import GradientBoostingRegressor

        lags = 7
        X, Y = [], []
        for i in range(lags, n):
            X.append(y[i - lags : i])
            Y.append(y[i])
        model = GradientBoostingRegressor(random_state=42, n_estimators=120, max_depth=2)
        model.fit(np.array(X), np.array(Y))
        hist = list(y)
        preds = []
        for _ in range(horizon):
            p = float(model.predict(np.array([hist[-lags:]]))[0])
            preds.append(p)
            hist.append(p)
        predictions = np.array(preds)
    else:
        predictions = np.full(horizon, float(y[-1]))

    # --- uncertainty band ---------------------------------------------------
    resid_std = float(np.std(valid_y - chosen["predict"](valid_t))) if chosen["validation"]["n"] else float(np.std(y))
    if not math.isfinite(resid_std):
        resid_std = 0.0
    band = [
        (round(float(p) - 1.96 * resid_std * math.sqrt(1 + (i + 1) * 0.15), 4),
         round(float(p) + 1.96 * resid_std * math.sqrt(1 + (i + 1) * 0.15), 4))
        for i, p in enumerate(predictions)
    ]

    # --- future period labels ----------------------------------------------
    last_ds = series["ds"].iloc[-1]
    if time_field:
        # Infer the sampling cadence from the gaps between observations rather
        # than trusting pd.infer_freq, which fails on short or irregular series.
        deltas = series["ds"].diff().dropna().dt.days
        median_gap = float(deltas.median()) if len(deltas) else 1.0
        if median_gap >= 27:
            freq = "MS"                      # monthly
        elif median_gap >= 6:
            freq = "7D"                      # weekly
        elif median_gap >= 0.9:
            freq = "D"                       # daily
        else:
            freq = "D"
        future_ds = pd.date_range(last_ds, periods=horizon + 1, freq=freq)[1:]
    else:
        future_ds = pd.date_range(last_ds, periods=horizon + 1, freq="D")[1:]

    history_points = [
        {"period": series["ds"].iloc[i].strftime("%Y-%m-%d"), "actual": _num(y[i])}
        for i in range(n)
    ]
    forecast_points = [
        {
            "period": future_ds[i].strftime("%Y-%m-%d"),
            "predicted": _num(predictions[i]),
            "lower": band[i][0],
            "upper": band[i][1],
        }
        for i in range(horizon)
    ]

    model_comparison = [
        {
            "modelType": meta["modelType"],
            "label": meta["label"],
            "metrics": meta["validation"],
            "selected": key == chosen_key,
        }
        for key, meta in candidates.items()
    ]

    return {
        "modelType": chosen_key,
        "modelLabel": chosen["label"],
        "targetColumn": target_column,
        "timeField": time_field,
        "horizon": horizon,
        "observations": n,
        "validationPeriods": validation_periods,
        "metrics": chosen["validation"],
        "baselineMetrics": candidates["baseline_naive"]["validation"],
        "beatsBaseline": chosen_rmse < baseline_rmse,
        "modelComparison": model_comparison,
        "history": history_points,
        "forecast": forecast_points,
        "warnings": warnings,
        "disclaimer": "Forecasts are statistical estimates based on historical patterns, not guarantees.",
    }
