"""The system reads: API-35 (the controller's hardware budget), API-36 (data continuity) and API-37 (delivery).

No auth and no SQL: ``api/operator_api.py`` includes ``router`` under ``/v1`` with its bearer, session and role
checks, and each route calls one ``verdify_services.system_health`` function, whose statements are the ones the
operator API's ``/metrics`` runs. Query values pass through unchanged; the services' types refuse anything else.
"""

from __future__ import annotations

from fastapi import APIRouter

from operator_routes.reads import Connection
from verdify_services import system_health

router = APIRouter()


@router.get(
    "/system/controller",
    operation_id="API-35",
    tags=["system"],
    response_model=system_health.ControllerHealth,
)
async def get_controller(conn: Connection) -> system_health.ControllerHealth:
    """The controller's hardware budget now, against its limits."""
    return await system_health.controller(conn)


@router.get("/system/data", operation_id="API-36", tags=["system"], response_model=system_health.DataContinuity)
async def get_data(conn: Connection, days: system_health.DataDays = 1) -> system_health.DataContinuity:
    """Whether telemetry is flowing, what was lost and what the gap log restored, over 1, 7 or 30 days."""
    return await system_health.data(conn, days=days)


@router.get("/system/delivery", operation_id="API-37", tags=["system"], response_model=system_health.Delivery)
async def get_delivery(conn: Connection, hours: system_health.DeliveryHours = 24) -> system_health.Delivery:
    """Whether the controller took what the host pushed, over 24 or 168 hours."""
    return await system_health.delivery(conn, hours=hours)
