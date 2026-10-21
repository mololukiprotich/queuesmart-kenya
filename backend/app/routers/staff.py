"""
Staff console endpoints — the operational core. This is the tool an agent
uses all day, so every action here is deliberately one call: call-next picks
the ticket AND notifies the citizen AND starts the service clock in one
request, rather than making the agent perform three separate steps.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.estimator import update_rolling_average
from app.ws import manager
from app.auth import hash_password, create_session, get_current_staff
from app.push import send_push
from app.routers.queue import check_notify_thresholds

router = APIRouter()


@router.post("/login", response_model=schemas.LoginResponse)
def staff_login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username).first()
    if not user or user.role == models.Role.citizen or user.password_hash != hash_password(payload.password):
        raise HTTPException(401, "Incorrect username or password")
    token = create_session(user.id)
    return schemas.LoginResponse(token=token, staff=user)


@router.get("/me", response_model=schemas.StaffOut)
def staff_me(current: models.User = Depends(get_current_staff)):
    return current


@router.post("/counters/{counter_id}/call-next", response_model=schemas.CallNextOut)
async def call_next(counter_id: str, db: Session = Depends(get_db), _staff: models.User = Depends(get_current_staff)):
    counter = db.query(models.Counter).get(counter_id)
    if not counter:
        raise HTTPException(404, "Counter not found")
    if not counter.service_ids:
        raise HTTPException(400, "This counter has no service assigned")

    ticket = (
        db.query(models.Ticket)
        .filter(
            models.Ticket.service_id.in_(counter.service_ids),
            models.Ticket.status == models.TicketStatus.waiting,
        )
        .order_by(models.Ticket.issued_at.asc())  # oldest-waiting-first — FIFO per service
        .first()
    )
    if not ticket:
        return schemas.CallNextOut(ticket=None, message="Queue is empty")

    ticket.status = models.TicketStatus.called
    ticket.called_at = datetime.utcnow()
    db.commit()
    db.refresh(ticket)

    await manager.broadcast(ticket.service_id, {"type": "queue_update", "service_id": ticket.service_id})
    # webpush() is a blocking HTTP call — offload it so it can't stall the
    # event loop (and therefore every other citizen's WS/API traffic).
    await run_in_threadpool(
        send_push, db, ticket.phone, "It's your turn", f"Ticket {ticket.number} — please proceed to the counter."
    )
    # Everyone still waiting in this service just moved up one position.
    # check_notify_thresholds can call send_push (blocking) per ticket —
    # offload it for the same reason as the call above.
    await run_in_threadpool(check_notify_thresholds, db, ticket.service_id)
    return schemas.CallNextOut(ticket=ticket, message=f"Called {ticket.number}")


@router.post("/tickets/{ticket_id}/complete", response_model=schemas.TicketOut)
async def complete_ticket(ticket_id: str, db: Session = Depends(get_db), _staff: models.User = Depends(get_current_staff)):
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if ticket.status not in (models.TicketStatus.called, models.TicketStatus.serving):
        raise HTTPException(400, f"Cannot complete a ticket in status {ticket.status}")

    ticket.status = models.TicketStatus.done
    ticket.completed_at = datetime.utcnow()

    # Feed this real service duration back into the estimator's rolling average.
    service = db.query(models.Service).get(ticket.service_id)
    duration = (ticket.completed_at - ticket.called_at).total_seconds()
    service.avg_service_time_seconds = update_rolling_average(
        service.avg_service_time_seconds, service.completed_count, duration
    )
    service.completed_count += 1

    if ticket.case_id:
        # Advance the case to its next step. The citizen rejoins the queue
        # separately for that step — completing one visit doesn't auto-issue
        # the next ticket, since there's usually a real-world gap (a
        # document to collect, a processing delay) between visits.
        case = db.query(models.Case).get(ticket.case_id)
        case.current_step += 1
        if case.current_step >= len(service.visit_steps):
            case.status = models.CaseStatus.completed

    db.commit()
    db.refresh(ticket)

    await manager.broadcast(ticket.service_id, {"type": "queue_update", "service_id": ticket.service_id})
    # The just-fed rolling average can move the estimate for everyone still
    # waiting, even though completing this ticket didn't change their
    # position (it was already out of the "waiting" count once called).
    await run_in_threadpool(check_notify_thresholds, db, ticket.service_id)
    return ticket


@router.post("/tickets/{ticket_id}/no-show", response_model=schemas.TicketOut)
async def mark_no_show(ticket_id: str, db: Session = Depends(get_db), _staff: models.User = Depends(get_current_staff)):
    """
    A missed call does NOT delete the ticket — it's requeued by resetting
    to `waiting` with a fresh issued_at, so the citizen keeps their place
    rather than losing their whole wait over one missed SMS. Repeated
    no-shows are visible in the ticket history for a supervisor to review,
    rather than silently vanishing.
    """
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if ticket.status != models.TicketStatus.called:
        raise HTTPException(400, "Only a called ticket can be marked no-show")

    ticket.status = models.TicketStatus.waiting
    ticket.called_at = None
    ticket.issued_at = datetime.utcnow()  # sent to the back of the line

    service = db.query(models.Service).get(ticket.service_id)
    service.no_show_count += 1

    db.commit()
    db.refresh(ticket)

    await manager.broadcast(ticket.service_id, {"type": "queue_update", "service_id": ticket.service_id})
    # The no-show ticket moved to the back, so everyone who was behind it
    # just moved up one position.
    await run_in_threadpool(check_notify_thresholds, db, ticket.service_id)
    return ticket


@router.get("/counters/{counter_id}/queue", response_model=list[schemas.TicketOut])
def counter_queue(counter_id: str, db: Session = Depends(get_db), _staff: models.User = Depends(get_current_staff)):
    """The live waiting list an agent's console polls/displays."""
    counter = db.query(models.Counter).get(counter_id)
    if not counter:
        raise HTTPException(404, "Counter not found")
    return (
        db.query(models.Ticket)
        .filter(
            models.Ticket.service_id.in_(counter.service_ids or []),
            models.Ticket.status == models.TicketStatus.waiting,
        )
        .order_by(models.Ticket.issued_at.asc())
        .all()
    )


@router.get("/counters", response_model=list[schemas.CounterOut])
def list_counters(db: Session = Depends(get_db), _staff: models.User = Depends(get_current_staff)):
    return db.query(models.Counter).all()
