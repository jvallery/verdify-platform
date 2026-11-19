"""The daily record and the daily review: API-32 and API-33 (tag ``record``) and API-34 (tag ``review``).

No auth and no SQL: ``api/operator_api.py`` includes ``router`` under ``/v1`` with its bearer, session and role
dependencies, and each route calls one ``verdify_services.record`` or ``verdify_services.reviews`` function.
``connection`` lends one connection from the operator API's asyncpg pool, ``app.state.pool``. Query values pass
through unchanged: the services validate them, and a ``ServiceError`` propagates for the operator API to render as
``application/problem+json``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import date
from typing import Annotated

import asyncpg
from fastapi import APIRouter, Depends, Query, Request

from verdify_services import record, reviews

router = APIRouter()


async def connection(request: Request) -> AsyncIterator[asyncpg.Connection]:
    async with request.app.state.pool.acquire() as conn:
        yield conn


Connection = Annotated[asyncpg.Connection, Depends(connection)]
# from is a Python keyword: the parameter is from_ and the query key is from.
OptionalFromDate = Annotated[date | None, Query(alias="from")]


@router.get("/record/days", operation_id="API-32", tags=["record"], response_model=record.DailyRecord)
async def get_record_days(
    conn: Connection, from_: OptionalFromDate = None, to: date | None = None
) -> record.DailyRecord:
    """The daily record per local day (compliance, starts, run time, utilities, drying, alerts) with the 7- and
    30-day means over complete days, the day the law started and the means before and since it, whatever window is
    asked for."""
    return await record.record_days(conn, from_, to)


@router.get("/record/relay-check", operation_id="API-33", tags=["record"], response_model=record.RelayCheck)
async def get_relay_check(conn: Connection, days: record.CheckDays = 7) -> record.RelayCheck:
    """The controller's relay counters against the stored record, per local day and relay."""
    return await record.relay_check(conn, days=days)


@router.get("/reviews", operation_id="API-34", tags=["review"], response_model=reviews.ReviewPage)
async def get_reviews(
    conn: Connection, limit: int = reviews.LIMIT_DEFAULT, cursor: str | None = None
) -> reviews.ReviewPage:
    """The daily reviews newest first, the day's review state, token use and the band proposal that waits."""
    return await reviews.page(conn, limit=limit, cursor=cursor)
