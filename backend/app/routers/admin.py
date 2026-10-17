"""
Admin/supervisor endpoints — aggregate reads only, no mutation. Deliberately
separate from staff.py: a supervisor views load and throughput, they don't
act on individual tickets, so the permission boundary (once real auth
exists) sits cleanly between these two files.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.routers.queue import _active_counters
from app.auth import require_admin, require_admin_only

# Router-level dependency: every route here requires a logged-in supervisor
# or admin, not just any staff account — an agent can work a counter but
# shouldn't see branch-wide throughput/no-show numbers.
router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/citizens/{phone}/profile", response_model=schemas.ProfileAdminOut)
def citizen_profile(phone: str, db: Session = Depends(get_db), _admin=Depends(require_admin_only)):
    """
    The one place national_id is ever readable by staff — gated to the
    admin role specifically (see require_admin_only), not every supervisor
    who can open this router. Nothing in the counter console or the stats
    above this route ever joins in CitizenProfile.
    """
    profile = db.query(models.CitizenProfile).get(phone)
    if not profile:
        raise HTTPException(404, "No profile on file for this phone number")
    return schemas.ProfileAdminOut(
        phone=profile.phone,
        full_name=profile.full_name,
        national_id=profile.national_id,
        email=profile.email,
        consent_given=bool(profile.consent_given),
        consent_at=profile.consent_at,
    )


def _today_start() -> datetime:
    now = datetime.utcnow()
    return datetime(now.year, now.month, now.day)


@router.get("/stats", response_model=schemas.AdminStatsOut)
def admin_stats(db: Session = Depends(get_db)):
    today = _today_start()
    services = db.query(models.Service).all()

    service_stats = []
    served_today_total = 0
    no_show_total = 0

    for service in services:
        waiting_count = (
            db.query(models.Ticket)
            .filter(
                models.Ticket.service_id == service.id,
                models.Ticket.status == models.TicketStatus.waiting,
            )
            .count()
        )
        served_today = (
            db.query(models.Ticket)
            .filter(
                models.Ticket.service_id == service.id,
                models.Ticket.status == models.TicketStatus.done,
                models.Ticket.completed_at >= today,
            )
            .count()
        )
        service_stats.append(
            schemas.ServiceStatOut(
                service_id=service.id,
                service_name=service.name,
                waiting_count=waiting_count,
                active_counters=_active_counters(db, service.id),
                avg_service_time_seconds=service.avg_service_time_seconds,
                served_today=served_today,
                no_show_count=service.no_show_count,
            )
        )
        served_today_total += served_today
        no_show_total += service.no_show_count

    waiting_now_total = sum(s.waiting_count for s in service_stats)
    # Cumulative rate (no-shows vs. all outcomes) rather than day-scoped —
    # a no-show event isn't logged with its own timestamp (see staff.py
    # mark_no_show, which deliberately reuses the ticket row), so "today"
    # isn't recoverable without a dedicated event log. Honest cumulative
    # beats a fake-precise "today" number.
    denom = sum(s.completed_count for s in services) + no_show_total
    no_show_rate = (no_show_total / denom) if denom else 0.0

    return schemas.AdminStatsOut(
        served_today=served_today_total,
        waiting_now=waiting_now_total,
        no_show_rate=no_show_rate,
        services=service_stats,
    )


@router.get("/timeseries", response_model=schemas.TimeseriesOut)
def admin_timeseries(hours: int = 12, db: Session = Depends(get_db)):
    """
    Completions bucketed by hour for the last `hours` hours — the raw
    material for the admin "throughput over time" chart. Bucketed in
    Python rather than a DB-specific date_trunc so this stays portable
    between SQLite (dev) and Postgres (pilot) without SQL dialect branches.
    """
    now = datetime.utcnow()
    start = now - timedelta(hours=hours)

    completed = (
        db.query(models.Ticket.completed_at)
        .filter(models.Ticket.status == models.TicketStatus.done, models.Ticket.completed_at >= start)
        .all()
    )

    buckets = {}
    for i in range(hours + 1):
        hour_mark = (start + timedelta(hours=i)).replace(minute=0, second=0, microsecond=0)
        buckets[hour_mark] = 0

    for (completed_at,) in completed:
        hour_mark = completed_at.replace(minute=0, second=0, microsecond=0)
        if hour_mark in buckets:
            buckets[hour_mark] += 1

    points = [
        schemas.TimeseriesPointOut(label=hour.strftime("%H:%M"), completed=count)
        for hour, count in sorted(buckets.items())
    ]
    return schemas.TimeseriesOut(points=points)
