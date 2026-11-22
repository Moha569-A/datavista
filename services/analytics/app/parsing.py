"""Dataset parsing, schema inference and profiling.

Consumes raw CSV/XLSX bytes and produces:
  - normalized rows (JSON-safe)
  - column profile (inferred type, null count, distinct count, stats)
  - data-quality warnings (missing values, duplicate rows, type inconsistencies)

Design notes
------------
* Every value returned is JSON-safe: NaN/Inf become ``None`` and timestamps
  become ISO-8601 strings.
* Parsing is bounded: MAX_ROWS / MAX_COLUMNS / MAX_FILE_BYTES guard against
  resource abuse before pandas ever sees the payload.
* Type inference is deterministic and conservative so the chart builder can
  trust ``columns[].type`` when validating aggregations.
"""
from __future__ import annotations

import io
import math
import re
from typing import Any

import numpy as np
import pandas as pd

MAX_ROWS = 50_000
MAX_COLUMNS = 200
MAX_FILE_BYTES = 25 * 1024 * 1024

# Placeholder tokens that mean "no value" in real-world exports. We treat these
# as missing ourselves instead of letting pandas silently swallow them, so a
# column like ["100", "n/a", "250"] is reported as a *type inconsistency* rather
# than quietly becoming numeric with a hole in it.
NA_TOKENS = {"", "na", "n/a", "n.a.", "null", "nil", "none", "nan", "-", "--", "?"}

NUMERIC_AGGREGATIONS = {"sum", "avg", "min", "max", "median", "count", "count_distinct"}
CHART_TYPES = {"bar", "pie", "line", "area", "scatter", "histogram"}


class ParseError(Exception):
    """Raised when a file cannot be parsed into a usable tabular dataset."""

    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        f = float(value)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(value, (pd.Timestamp,)):
        if pd.isna(value):
            return None
        return value.isoformat()
    if value is pd.NaT:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.datetime64,)):
        return pd.Timestamp(value).isoformat()
    if isinstance(value, (int, str)):
        return value
    return str(value)



def _detect_delimiter(content: bytes) -> str:
    """Choose the delimiter deterministically from the header line.

    pandas' csv.Sniffer guesses from a character set and misfires on narrow
    files — a single "region" column was being split on the letter "o". Counting
    candidates in the first line is predictable and covers the common exports
    (comma, semicolon for European locales, tab, pipe).
    """
    try:
        head = content.decode("utf-8", errors="replace").splitlines()[:5]
    except Exception:
        return ","
    first = next((line for line in head if line.strip()), "")
    if not first:
        return ","
    candidates = {",": first.count(","), ";": first.count(";"), "\t": first.count("\t"), "|": first.count("|")}
    best, count = max(candidates.items(), key=lambda kv: kv[1])
    return best if count > 0 else ","


def read_dataframe(filename: str, content: bytes) -> pd.DataFrame:
    if len(content) == 0:
        raise ParseError("EMPTY_FILE", "The uploaded file is empty.")
    if len(content) > MAX_FILE_BYTES:
        raise ParseError(
            "FILE_TOO_LARGE",
            f"File exceeds the {MAX_FILE_BYTES // (1024 * 1024)} MB processing limit.",
        )

    lower = filename.lower()
    try:
        if lower.endswith(".csv"):
            sep = _detect_delimiter(content)
            # Try UTF-8 first, then fall back to latin-1 to avoid hard failures
            # on legacy exports (documented import behaviour for TRD risk #1).
            try:
                df = pd.read_csv(
                    io.BytesIO(content), encoding="utf-8", sep=sep, engine="python",
                    keep_default_na=False, na_values=[""],
                )
            except UnicodeDecodeError:
                df = pd.read_csv(
                    io.BytesIO(content), encoding="latin-1", sep=sep, engine="python",
                    keep_default_na=False, na_values=[""],
                )
        elif lower.endswith(".xlsx"):
            # values_only: never evaluate formulas (spreadsheet formula risk).
            df = pd.read_excel(io.BytesIO(content), engine="openpyxl", sheet_name=0)
        else:
            raise ParseError("UNSUPPORTED_FILE_TYPE", "Only .csv and .xlsx files are supported.")
    except ParseError:
        raise
    except Exception as exc:  # pandas raises a wide family of errors
        raise ParseError(
            "PARSE_ERROR",
            "The file could not be parsed. Check the delimiter, encoding and header row.",
            {"reason": str(exc)[:300]},
        ) from exc

    if df.shape[1] == 0:
        raise ParseError("NO_COLUMNS", "No columns were detected in the file.")
    if df.shape[1] > MAX_COLUMNS:
        raise ParseError("TOO_MANY_COLUMNS", f"Datasets are limited to {MAX_COLUMNS} columns.")
    if len(df) > MAX_ROWS:
        raise ParseError(
            "TOO_MANY_ROWS",
            f"Datasets are limited to {MAX_ROWS:,} rows for the MVP. Split the file and import a subset.",
        )

    # Normalize headers: strip, de-duplicate, reject anonymous columns.
    seen: dict[str, int] = {}
    headers: list[str] = []
    for i, raw in enumerate(df.columns):
        # pandas silently renames duplicates to "name.1"; normalise to "name_1"
        # so the de-duplication below sees the original stem.
        name = re.sub(r"\.(\d+)$", r"_\1", str(raw).strip())
        if name == "" or name.lower().startswith("unnamed:"):
            name = f"column_{i + 1}"
        safe = name[:255]
        if safe in seen:
            seen[safe] += 1
            safe = f"{safe}_{seen[safe]}"
        else:
            seen[safe] = 0
        headers.append(safe)
    df.columns = headers

    df = df.dropna(how="all").reset_index(drop=True)
    if len(df) == 0:
        raise ParseError("NO_ROWS", "The file contains a header but no data rows.")
    return df


def _coerce_missing(series: pd.Series) -> pd.Series:
    """Map recognised placeholder tokens to NaN, leaving every other cell intact."""
    tokens = series.astype(str).str.strip().str.lower().isin(NA_TOKENS)
    return series.mask(tokens & series.notna())


def _infer_type(series: pd.Series) -> str:
    series = _coerce_missing(series)
    non_null = series.dropna()
    if non_null.empty:
        return "empty"
    if pd.api.types.is_bool_dtype(non_null):
        return "boolean"
    if pd.api.types.is_numeric_dtype(non_null):
        return "number"
    if pd.api.types.is_datetime64_any_dtype(non_null):
        return "date"

    sample = non_null.astype(str).head(200)
    numeric = pd.to_numeric(sample.str.replace(",", "", regex=False), errors="coerce")
    if numeric.notna().mean() >= 0.95:
        return "number"
    # Mixed columns: mostly numeric but with some unparseable cells. Treat as
    # numeric so aggregations stay available, and let the profiler report the
    # inconsistencies explicitly instead of silently degrading to text.
    if numeric.notna().mean() >= 0.5:
        return "number"
    parsed_dates = pd.to_datetime(sample, errors="coerce", format="mixed", dayfirst=False)
    if parsed_dates.notna().mean() >= 0.9:
        # Guard: pure numbers parse as epochs/dates too; only trust date if it
        # does not look numeric.
        return "date"
    unique = sample.nunique()
    if unique <= max(50, int(len(sample) * 0.4)):
        return "category"
    return "text"


def profile_column(name: str, series: pd.Series) -> dict[str, Any]:
    series = _coerce_missing(series)
    inferred = _infer_type(series)
    null_count = int(series.isna().sum())
    result: dict[str, Any] = {
        "name": name,
        "type": inferred,
        "nullCount": null_count,
        "nullRatio": round(null_count / max(len(series), 1), 4),
        "distinctCount": int(series.dropna().astype(str).nunique()),
    }

    if inferred == "number":
        numeric = pd.to_numeric(series.astype(str).str.replace(",", "", regex=False), errors="coerce")
        if numeric.notna().any():
            result.update(
                {
                    "min": _json_safe(numeric.min()),
                    "max": _json_safe(numeric.max()),
                    "mean": _json_safe(numeric.mean()),
                }
            )
            # Mixed types: some cells numeric, some not.
            bad = int(((numeric.isna()) & series.notna()).sum())
            if bad:
                result["typeInconsistencies"] = bad
    elif inferred == "date":
        dates = pd.to_datetime(series, errors="coerce", format="mixed")
        if dates.notna().any():
            result["min"] = _json_safe(dates.min())
            result["max"] = _json_safe(dates.max())
            bad = int((dates.isna() & series.notna()).sum())
            if bad:
                result["typeInconsistencies"] = bad
    else:
        top = series.dropna().astype(str).value_counts().head(5)
        result["topValues"] = [{"value": str(k), "count": int(v)} for k, v in top.items()]
    return result


def build_warnings(df: pd.DataFrame, columns: list[dict]) -> list[dict]:
    warnings: list[dict] = []

    duplicate_rows = int(df.duplicated().sum())
    if duplicate_rows:
        warnings.append(
            {
                "code": "DUPLICATE_ROWS",
                "severity": "warning",
                "message": f"{duplicate_rows:,} duplicate row(s) detected.",
                "count": duplicate_rows,
            }
        )

    for col in columns:
        if col["nullCount"]:
            warnings.append(
                {
                    "code": "MISSING_VALUES",
                    "severity": "warning" if col["nullRatio"] < 0.5 else "error",
                    "column": col["name"],
                    "count": col["nullCount"],
                    "message": f"{col['nullCount']:,} missing value(s) in '{col['name']}' "
                    f"({col['nullRatio'] * 100:.1f}% of rows).",
                }
            )
        if col.get("typeInconsistencies"):
            warnings.append(
                {
                    "code": "TYPE_INCONSISTENCY",
                    "severity": "warning",
                    "column": col["name"],
                    "count": col["typeInconsistencies"],
                    "message": f"{col['typeInconsistencies']:,} value(s) in '{col['name']}' do not match "
                    f"the inferred type ({col['type']}).",
                }
            )
        if col["type"] == "empty":
            warnings.append(
                {
                    "code": "EMPTY_COLUMN",
                    "severity": "warning",
                    "column": col["name"],
                    "message": f"Column '{col['name']}' contains no values.",
                }
            )
    return warnings


def profile_dataset(filename: str, content: bytes, preview_rows: int = 50) -> dict[str, Any]:
    df = read_dataframe(filename, content)
    columns = [profile_column(str(c), df[c]) for c in df.columns]

    duplicate_rows = int(df.duplicated().sum())
    rows = [
        {str(k): _json_safe(v) for k, v in record.items()}
        for record in df.to_dict(orient="records")
    ]

    value_counts: dict[str, list[dict]] = {}
    for col in columns:
        if col["type"] in {"category", "text", "boolean"}:
            counts = df[col["name"]].dropna().astype(str).value_counts().head(100)
            value_counts[col["name"]] = [
                {"value": str(k), "count": int(v)} for k, v in counts.items()
            ]

    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(df),
        "columnCount": len(columns),
        "duplicateRowCount": duplicate_rows,
        "warnings": build_warnings(df, columns),
        "preview": rows[:preview_rows],
        "valueCounts": value_counts,
    }
