"""Chart query engine.

All aggregation happens here, against an in-memory pandas frame built from the
rows the API has already authorized. There is no SQL string construction, so
column names can never be injected into a statement — fields are validated
against the dataset schema by the caller *and* re-checked here.

Group cardinality, filter count and result size are all bounded.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

MAX_GROUPS = 200
MAX_FILTERS = 10
AGGREGATIONS = {"sum", "avg", "count", "count_distinct", "min", "max", "median", "none"}
NUMERIC_ONLY_AGGS = {"sum", "avg", "median"}


class QueryError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        value = float(value)
    if isinstance(value, float):
        return None if (math.isnan(value) or math.isinf(value)) else round(value, 6)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def to_frame(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def apply_filters(df: pd.DataFrame, filters: list[dict]) -> pd.DataFrame:
    if not filters:
        return df
    if len(filters) > MAX_FILTERS:
        raise QueryError("TOO_MANY_FILTERS", f"A maximum of {MAX_FILTERS} filters is allowed.")
    out = df
    for f in filters:
        field = f.get("field")
        op = f.get("operator", "eq")
        value = f.get("value")
        if field not in out.columns:
            raise QueryError("UNKNOWN_FIELD", f"Filter field '{field}' is not part of this dataset.")
        series = out[field]
        if op in {"eq", "neq", "contains", "gt", "gte", "lt", "lte"}:
            pass
        else:
            raise QueryError("INVALID_OPERATOR", f"Filter operator '{op}' is not supported.")

        if op in {"gt", "gte", "lt", "lte"}:
            numeric = pd.to_numeric(series, errors="coerce")
            try:
                num_value = float(value)
            except (TypeError, ValueError):
                raise QueryError("INVALID_FILTER_VALUE", "Numeric comparison requires a number.")
            mask = {
                "gt": numeric > num_value,
                "gte": numeric >= num_value,
                "lt": numeric < num_value,
                "lte": numeric <= num_value,
            }[op]
        elif op == "contains":
            mask = series.astype(str).str.contains(str(value), case=False, na=False, regex=False)
        elif op == "eq":
            mask = series.astype(str) == str(value)
        else:
            mask = series.astype(str) != str(value)
        out = out[mask.fillna(False)]
    return out


def run_query(
    rows: list[dict],
    columns: list[dict],
    chart_type: str,
    x_field: str | None,
    y_field: str | None,
    aggregation: str = "sum",
    filters: list[dict] | None = None,
    limit: int = MAX_GROUPS,
    sort: str = "desc",
) -> dict[str, Any]:
    if chart_type not in {"bar", "pie", "line", "area", "scatter", "histogram"}:
        raise QueryError("INVALID_CHART_TYPE", f"Chart type '{chart_type}' is not supported.")
    if aggregation not in AGGREGATIONS:
        raise QueryError("INVALID_AGGREGATION", f"Aggregation '{aggregation}' is not supported.")

    by_name = {c["name"]: c for c in columns}
    df = to_frame(rows)
    if df.empty:
        return {"data": [], "meta": {"rowCount": 0, "groupCount": 0, "filteredRowCount": 0}}

    for field in [x_field, y_field]:
        if field and field not in df.columns:
            raise QueryError("UNKNOWN_FIELD", f"Column '{field}' is not part of this dataset.")
        if field and field not in by_name:
            raise QueryError("UNKNOWN_FIELD", f"Column '{field}' is missing from the dataset schema.")

    df = apply_filters(df, filters or [])
    filtered_count = int(len(df))
    if filtered_count == 0:
        return {
            "data": [],
            "meta": {
                "rowCount": 0,
                "groupCount": 0,
                "filteredRowCount": 0,
                "note": "No rows match the current filters.",
            },
        }

    if chart_type == "histogram":
        if not y_field:
            raise QueryError("MISSING_FIELD", "Histogram requires a numeric field.")
        numeric = pd.to_numeric(df[y_field], errors="coerce").dropna()
        if numeric.empty:
            raise QueryError(
                "INCOMPATIBLE_FIELD",
                f"'{y_field}' contains no numeric values, so a histogram cannot be drawn.",
            )
        bins = min(20, max(5, int(math.sqrt(len(numeric)))))
        counts, edges = np.histogram(numeric.to_numpy(), bins=bins)
        data = [
            {"label": f"{_clean(edges[i])}–{_clean(edges[i + 1])}", "value": int(counts[i])}
            for i in range(len(counts))
        ]
        return {
            "data": data,
            "meta": {"rowCount": len(numeric), "groupCount": len(data), "filteredRowCount": filtered_count},
        }

    if not x_field:
        raise QueryError("MISSING_FIELD", f"{chart_type} charts require an x-axis field.")

    if chart_type == "scatter" or aggregation == "none":
        if not y_field:
            raise QueryError("MISSING_FIELD", "This chart requires a value field.")
        subset = df[[x_field, y_field]].dropna().head(limit)
        data = [
            {"label": _clean(r[x_field]), "value": _clean(r[y_field])}
            for r in subset.to_dict(orient="records")
        ]
        return {
            "data": data,
            "meta": {"rowCount": len(data), "groupCount": len(data), "filteredRowCount": filtered_count},
        }

    if not y_field:
        raise QueryError("MISSING_FIELD", "A value field is required for aggregation.")
    if aggregation in NUMERIC_ONLY_AGGS:
        numeric = pd.to_numeric(df[y_field], errors="coerce")
        if numeric.notna().sum() == 0:
            raise QueryError(
                "INCOMPATIBLE_FIELD",
                f"'{y_field}' is not numeric, so '{aggregation}' cannot be applied. "
                "Choose 'count' or pick a numeric field.",
            )
        df = df.assign(__value=numeric)
        value_col = "__value"
    else:
        df = df.assign(__value=df[y_field])
        value_col = "__value"

    grouped = df.groupby(df[x_field].astype(str), dropna=False)["__value"]
    if aggregation == "sum":
        series = grouped.sum()
    elif aggregation == "avg":
        series = grouped.mean()
    elif aggregation == "median":
        series = grouped.median()
    elif aggregation == "min":
        series = grouped.min()
    elif aggregation == "max":
        series = grouped.max()
    elif aggregation == "count_distinct":
        series = df.dropna(subset=[value_col]).groupby(df[x_field].astype(str))[value_col].nunique()
    else:  # count
        series = grouped.count()

    series = series.replace([np.inf, -np.inf], np.nan).dropna()
    if series.empty:
        return {
            "data": [],
            "meta": {
                "rowCount": 0,
                "groupCount": 0,
                "filteredRowCount": filtered_count,
                "note": "Aggregation produced no values for the selected fields.",
            },
        }

    group_count = int(len(series))
    top = series.sort_values(ascending=(sort != "desc")).head(min(limit, MAX_GROUPS))
    data = [{"label": str(label), "value": _clean(value)} for label, value in top.items()]

    # Preserve chronological order for line/area charts when labels look like dates.
    if chart_type in {"line", "area"}:
        try:
            parsed = pd.to_datetime([d["label"] for d in data], errors="coerce", format="mixed")
            if not pd.isna(parsed).all():
                order = np.argsort(parsed.values)
                data = [data[i] for i in order]
        except Exception:
            pass

    return {
        "data": data,
        "meta": {
            "rowCount": filtered_count,
            "groupCount": group_count,
            "filteredRowCount": filtered_count,
            "truncated": group_count > len(data),
            "limit": min(limit, MAX_GROUPS),
        },
    }
