"""DataVista Analytics service.

Internal service: never exposed publicly. The Express API is the only client
and it authenticates with a shared service token. Every request body is
validated before any pandas/sklearn work happens.
"""
from __future__ import annotations

import base64
import hmac
import os
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from .forecasting import ForecastError, run_forecast
from .parsing import ParseError, profile_dataset
from .query import QueryError, run_query

load_dotenv()

SERVICE_TOKEN = os.getenv("ANALYTICS_SERVICE_TOKEN", "dev-analytics-token")

app = FastAPI(
    title="DataVista Analytics Service",
    version="1.0.0",
    description="Parsing, profiling, aggregation and forecasting. Internal only.",
)


def require_service_token(x_service_token: str = Header(default="")) -> None:
    if not hmac.compare_digest(x_service_token, SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED_SERVICE", "message": "Invalid service token."})


class ProfileRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    contentBase64: str = Field(min_length=1)


class ColumnSchema(BaseModel):
    name: str
    type: str


class Filter(BaseModel):
    field: str
    operator: str = "eq"
    value: Any = None


class QueryRequest(BaseModel):
    rows: list[dict]
    columns: list[ColumnSchema]
    chartType: str
    xField: str | None = None
    yField: str | None = None
    aggregation: str = "sum"
    filters: list[Filter] = Field(default_factory=list)
    limit: int = 200
    sort: str = "desc"


class ForecastRequest(BaseModel):
    rows: list[dict]
    targetColumn: str
    timeField: str | None = None
    horizon: int = 12
    modelType: str = "auto"


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "analytics", "version": app.version}


@app.post("/profile", dependencies=[Depends(require_service_token)])
def profile(req: ProfileRequest) -> dict:
    try:
        content = base64.b64decode(req.contentBase64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_PAYLOAD", "message": "contentBase64 is not valid base64."})
    try:
        return profile_dataset(req.filename, content)
    except ParseError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message, "details": exc.details})


@app.post("/query", dependencies=[Depends(require_service_token)])
def query(req: QueryRequest) -> dict:
    try:
        return run_query(
            rows=req.rows,
            columns=[c.model_dump() for c in req.columns],
            chart_type=req.chartType,
            x_field=req.xField,
            y_field=req.yField,
            aggregation=req.aggregation,
            filters=[f.model_dump() for f in req.filters],
            limit=req.limit,
            sort=req.sort,
        )
    except QueryError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message, "details": exc.details})


@app.post("/forecast", dependencies=[Depends(require_service_token)])
def forecast(req: ForecastRequest) -> dict:
    try:
        return run_forecast(
            rows=req.rows,
            target_column=req.targetColumn,
            time_field=req.timeField,
            horizon=req.horizon,
            model_type=req.modelType,
        )
    except ForecastError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message, "details": exc.details})
