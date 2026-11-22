"""Parsing, schema inference and quality profiling tests."""
import io

import pandas as pd
import pytest

from app.parsing import ParseError, profile_column, profile_dataset, read_dataframe


def csv_bytes(text: str) -> bytes:
    return text.encode("utf-8")


def test_reads_simple_csv():
    df = read_dataframe("data.csv", csv_bytes("a,b\n1,2\n3,4\n"))
    assert list(df.columns) == ["a", "b"]
    assert len(df) == 2


def test_normalises_duplicate_and_blank_headers():
    df = read_dataframe("data.csv", csv_bytes("name,name,,x\n1,2,3,4\n"))
    assert df.columns[0] == "name"
    assert df.columns[1] == "name_1"
    assert df.columns[2] == "column_3"
    assert df.columns[3] == "x"


def test_drops_fully_empty_rows():
    df = read_dataframe("data.csv", csv_bytes("a,b\n1,2\n,\n3,4\n"))
    assert len(df) == 2


def test_rejects_empty_file():
    with pytest.raises(ParseError) as exc:
        read_dataframe("empty.csv", b"")
    assert exc.value.code == "EMPTY_FILE"


def test_rejects_unsupported_extension():
    with pytest.raises(ParseError) as exc:
        read_dataframe("notes.txt", b"a,b\n1,2\n")
    assert exc.value.code == "UNSUPPORTED_FILE_TYPE"


def test_rejects_header_only_file():
    with pytest.raises(ParseError) as exc:
        read_dataframe("header.csv", b"a,b,c\n")
    assert exc.value.code == "NO_ROWS"


def test_rejects_malformed_xlsx():
    with pytest.raises(ParseError) as exc:
        read_dataframe("broken.xlsx", b"this is not a spreadsheet")
    assert exc.value.code == "PARSE_ERROR"


def test_reads_real_xlsx_round_trip():
    frame = pd.DataFrame({"region": ["North", "South"], "revenue": [10, 20]})
    buffer = io.BytesIO()
    frame.to_excel(buffer, index=False, engine="openpyxl")
    df = read_dataframe("book.xlsx", buffer.getvalue())
    assert len(df) == 2
    assert list(df.columns) == ["region", "revenue"]


def test_type_inference():
    series_numeric = pd.Series(["1", "2", "3"])
    assert profile_column("n", series_numeric)["type"] == "number"

    assert profile_column("c", pd.Series(["a", "b", "a"]))["type"] == "category"

    dates = pd.Series(["2026-01-01", "2026-01-02", "2026-01-03"])
    assert profile_column("d", dates)["type"] == "date"

    long_text = pd.Series([f"value-{i}" for i in range(100)])
    assert profile_column("t", long_text)["type"] == "text"


def test_mixed_column_is_numeric_with_flagged_inconsistencies():
    # "unknown" is genuine text in a numeric column -> inconsistency.
    profile = profile_column("amount", pd.Series(["100", "unknown", "250", "300"]))
    assert profile["type"] == "number"
    assert profile["typeInconsistencies"] == 1


def test_placeholder_tokens_count_as_missing_values():
    # "n/a" means "no value", so it is missing rather than a type mismatch.
    profile = profile_column("amount", pd.Series(["100", "n/a", "250", "300"]))
    assert profile["type"] == "number"
    assert profile["nullCount"] == 1
    assert "typeInconsistencies" not in profile


def test_profile_reports_nulls_and_stats():
    profile = profile_column("revenue", pd.Series([100.0, None, 300.0]))
    assert profile["nullCount"] == 1
    assert profile["nullRatio"] == pytest.approx(0.3333, abs=1e-3)
    assert profile["min"] == 100.0
    assert profile["max"] == 300.0


def test_builds_warnings_for_quality_issues():
    result = profile_dataset(
        "messy.csv",
        csv_bytes("id,amount\n1,100\n2,unknown\n2,unknown\n2,250\n3,\n5,300\n"),
    )
    codes = {w["code"] for w in result["warnings"]}
    assert "DUPLICATE_ROWS" in codes
    assert "MISSING_VALUES" in codes
    assert "TYPE_INCONSISTENCY" in codes


def test_nan_values_become_null_in_json_output():
    result = profile_dataset("nan.csv", csv_bytes("a,b\n1,x\n,y\n"))
    first = result["rows"][1]
    assert first["a"] is None


def test_publishes_value_counts_for_categories():
    result = profile_dataset("cats.csv", csv_bytes("region\nNorth\nSouth\nNorth\n"))
    counts = result["valueCounts"]["region"]
    assert {"value": "North", "count": 2} in counts


def test_row_limit_is_enforced():
    text = "a\n" + "\n".join(str(i) for i in range(60000))
    with pytest.raises(ParseError) as exc:
        read_dataframe("big.csv", csv_bytes(text))
    assert exc.value.code == "TOO_MANY_ROWS"
