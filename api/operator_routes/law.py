"""The climate law's reads: API-30, what the controller's law is doing now and why, and API-31, its decisions over
time (dashboard v2 read model). No auth and no SQL here: each route calls one ``verdify_services.law`` function, and a
``ServiceError`` propagates for the operator API to render as ``application/problem+json``."""

from __future__ import annotations

from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime

from verdify_services import law as service

from .reads import connection

router = APIRouter(tags=["law"])

Connection = Annotated[asyncpg.Connection, Depends(connection)]
WindowStart = Annotated[AwareDatetime, Query(alias="from", description="Window start (inclusive)")]
WindowEnd = Annotated[AwareDatetime, Query(description="Window end (exclusive)")]


@router.get(
    "/law",
    operation_id="API-30",
    summary="What the controller's law is doing now and why: band, inputs, rules, drying, timing and running alone",
    response_model=service.LawView,
)
async def law(conn: Connection) -> service.LawView:
    return await service.law(conn)


@router.get(
    "/law/history",
    operation_id="API-31",
    summary="The law's requests and latches over time, drying, outdoor source, band repairs, drying cost and band",
    response_model=service.LawHistory,
)
async def law_history(conn: Connection, from_: WindowStart, to: WindowEnd) -> service.LawHistory:
    return await service.history(conn, from_, to)
