"""Chart aggregation tests against known fixtures (Implementation Plan §6)."""
import pytest

from app.query import QueryError, run_query

ROWS = [
    {"region": "North", "category": "Software", "revenue": 1000, "units": 10},
    {"region": "South", "category": "Software", "revenue": 500, "units": 5},
    {"region": "North", "category": "Hardware", "revenue": 1500, "units": 15},
    {"region": "East", "category": "Services", "revenue": 250, "units": 2},
    {"region": "West", "category": "Hardware", "revenue": 750, "units": 7},
]
COLUMNS = [
    {"name": "region", "type": "category"},
    {"name": "category", "type": "category"},
    {"name": "revenue", "type": "number"},
    {"name": "units", "type": "number"},
]


def q(**kwargs):
    params = dict(
        rows=ROWS, columns=COLUMNS, chart_type="bar",
        x_field="region", y_field="revenue", aggregation="sum",
    )
    params.update(kwargs)
    return run_query(**params)


def as_map(result):
    return {d["label"]: d["value"] for d in result["data"]}


def test_sum_by_category():
    result = q()
    assert as_map(result) == {"North": 2500, "South": 500, "East": 250, "West": 750}
    assert result["meta"]["filteredRowCount"] == 5


def test_average():
    assert as_map(q(x_field="category", aggregation="avg")) == {
        "Software": 750.0,
        "Hardware": 1125.0,
        "Services": 250.0,
    }


def test_count_counts_rows_not_values():
    assert as_map(q(aggregation="count"))["North"] == 2


def test_count_distinct():
    assert as_map(q(y_field="category", aggregation="count_distinct"))["North"] == 2


def test_min_max_median():
    assert as_map(q(aggregation="min"))["North"] == 1000
    assert as_map(q(aggregation="max"))["North"] == 1500
    assert as_map(q(aggregation="median"))["North"] == 1250


def test_filter_equality():
    result = q(filters=[{"field": "category", "operator": "eq", "value": "Hardware"}])
    assert as_map(result) == {"North": 1500, "West": 750}
    assert result["meta"]["filteredRowCount"] == 2


def test_filter_numeric_comparison():
    result = q(filters=[{"field": "revenue", "operator": "gte", "value": 700}])
    assert "East" not in as_map(result)


def test_filter_contains_is_literal_not_regex():
    result = q(filters=[{"field": "category", "operator": "contains", "value": "S"}])
    assert set(as_map(result)) <= {"North", "South", "East"}


def test_filters_can_empty_the_result():
    result = q(filters=[{"field": "region", "operator": "eq", "value": "Nowhere"}])
    assert result["data"] == []
    assert result["meta"]["rowCount"] == 0
    assert "note" in result["meta"]


def test_histogram_buckets_numeric_values():
    result = q(chart_type="histogram", x_field=None, y_field="revenue", aggregation="none")
    assert len(result["data"]) >= 5
    assert all(isinstance(d["value"], int) for d in result["data"])


def test_truncates_high_cardinality_results():
    rows = [{"g": f"g{i}", "v": i} for i in range(500)]
    result = run_query(
        rows=rows,
        columns=[{"name": "g", "type": "category"}, {"name": "v", "type": "number"}],
        chart_type="bar", x_field="g", y_field="v", aggregation="sum", limit=50,
    )
    assert result["meta"]["truncated"] is True
    assert len(result["data"]) == 50
    assert result["meta"]["groupCount"] == 500


def test_rejects_unknown_field():
    with pytest.raises(QueryError) as exc:
        q(x_field="nope")
    assert exc.value.code == "UNKNOWN_FIELD"


def test_rejects_sum_over_text():
    with pytest.raises(QueryError) as exc:
        q(y_field="category", aggregation="sum")
    assert exc.value.code == "INCOMPATIBLE_FIELD"


def test_rejects_invalid_chart_type():
    with pytest.raises(QueryError) as exc:
        q(chart_type="sunburst")
    assert exc.value.code == "INVALID_CHART_TYPE"


def test_rejects_too_many_filters():
    filters = [{"field": "region", "operator": "eq", "value": "North"}] * 11
    with pytest.raises(QueryError) as exc:
        q(filters=filters)
    assert exc.value.code == "TOO_MANY_FILTERS"


def test_handles_empty_dataset():
    result = run_query(rows=[], columns=COLUMNS, chart_type="bar", x_field="region", y_field="revenue")
    assert result["data"] == []
    assert result["meta"]["rowCount"] == 0
