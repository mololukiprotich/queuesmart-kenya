"""
Citizen-facing endpoints: browse branches/services, join a queue, check
live state. No auth required yet — OTP comes later as a layered addition;
right now identity is just "the phone number you typed," which is enough
to build and test the whole ticket lifecycle before adding the SMS gateway
dependency.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.estimator import estimate_wait_seconds
from app.ws import manager
from app.push import VAPID_PUBLIC_KEY_B64URL, send_push

router = APIRouter()


@router.get("/push/vapid-public-key", response_model=schemas.VapidPublicKeyOut)
def push_vapid_public_key():
    """The client needs this to call pushManager.subscribe() — it's public
    by nature (it's embedded in every subscription request sent to the
    browser vendor's push service), only the private key is secret."""
    return schemas.VapidPublicKeyOut(public_key=VAPID_PUBLIC_KEY_B64URL)


@router.post("/push/subscribe")
def push_subscribe(payload: schemas.PushSubscribeRequest, db: Session = Depends(get_db)):
    """
    Public, like ticket creation — a citizen subscribes their own browser to
    their own phone number. Upserted by endpoint (one row per browser
    install) so re-subscribing never accumulates duplicates.
    """
    existing = db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == payload.endpoint
    ).first()
    if existing:
        existing.phone = payload.phone
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
    else:
        db.add(models.PushSubscription(
            phone=payload.phone,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        ))
    db.commit()
    return {"status": "subscribed"}


@router.get("/branches", response_model=list[schemas.BranchOut])
def list_branches(db: Session = Depends(get_db)):
    return db.query(models.Branch).all()


@router.get("/branches/{branch_id}/services", response_model=list[schemas.ServiceOut])
def list_services(branch_id: str, db: Session = Depends(get_db)):
    return db.query(models.Service).filter(models.Service.branch_id == branch_id).all()


@router.get("/branches/{branch_id}/queue-overview", response_model=schemas.BranchQueueOverviewOut)
def branch_queue_overview(branch_id: str, db: Session = Depends(get_db)):
    """
    Public, read-only snapshot of every counter's current line at a branch —
    "how long is each line, right now." No auth needed: this is the same
    information a citizen would see by walking into the building and
    looking, just available before they leave home. Built branch-shaped
    (not ticket-shaped) specifically so it can also power a no-login
    waiting-room signage screen, not just the citizen app.

    Reuses the existing per-service estimator rather than inventing new
    math: each counter's wait is computed as if it were the sole active
    counter for a synthetic "service" whose average handling time is the
    waiting-weighted mean of the real services it's assigned to (falling
    back to a plain mean when nobody's waiting there yet).
    """
    counters = db.query(models.Counter).filter(models.Counter.branch_id == branch_id).all()
    services = db.query(models.Service).filter(models.Service.branch_id == branch_id).all()
    services_by_id = {s.id: s for s in services}

    # Computed separately from the per-counter sum below, which would
    # double-count a service assigned to more than one counter.
    total_waiting = (
        db.query(models.Ticket)
        .filter(
            models.Ticket.service_id.in_([s.id for s in services]),
            models.Ticket.status == models.TicketStatus.waiting,
        )
        .count()
    ) if services else 0

    out = []
    longest_wait = 0.0
    for counter in counters:
        service_ids = counter.service_ids or []
        waiting_count = 0
        weighted_time_sum = 0.0
        plain_time_sum = 0.0
        service_names = []
        for sid in service_ids:
            service = services_by_id.get(sid)
            if not service:
                continue
            service_names.append(service.name)
            plain_time_sum += service.avg_service_time_seconds
            n = (
                db.query(models.Ticket)
                .filter(models.Ticket.service_id == sid, models.Ticket.status == models.TicketStatus.waiting)
                .count()
            )
            waiting_count += n
            weighted_time_sum += n * service.avg_service_time_seconds

        avg_time = (
            weighted_time_sum / waiting_count if waiting_count > 0
            else (plain_time_sum / len(service_ids) if service_ids else 600.0)
        )
        wait = estimate_wait_seconds(waiting_count, 1, avg_time)

        out.append(schemas.CounterOverviewOut(
            counter_id=counter.id, label=counter.label, service_names=service_names,
            waiting_count=waiting_count, estimated_wait_seconds=wait,
        ))
        longest_wait = max(longest_wait, wait)

    return schemas.BranchQueueOverviewOut(
        branch_id=branch_id, counters=out, total_waiting=total_waiting, longest_wait_seconds=longest_wait,
    )


def _active_counters(db: Session, service_id: str) -> int:
    """
    Counters currently assigned to this service. A proper pilot would track
    which counters are actively staffed right now (agent logged in this
    shift); for the prototype we treat "assigned" as "active" and flag this
    as the first thing to tighten once the staff login flow exists.
    """
    counters = db.query(models.Counter).all()
    return sum(1 for c in counters if service_id in (c.service_ids or [])) or 1


def _position(db: Session, ticket: models.Ticket) -> int:
    """How many waiting tickets for this service were issued before this one."""
    if ticket.status != models.TicketStatus.waiting:
        return 0
    ahead = (
        db.query(models.Ticket)
        .filter(
            models.Ticket.service_id == ticket.service_id,
            models.Ticket.status == models.TicketStatus.waiting,
            models.Ticket.issued_at < ticket.issued_at,
        )
        .count()
    )
    return ahead + 1


def build_queue_state(db: Session, ticket: models.Ticket) -> schemas.QueueStateOut:
    service = db.query(models.Service).get(ticket.service_id)
    position = _position(db, ticket)
    active = _active_counters(db, ticket.service_id)
    wait = estimate_wait_seconds(position, active, service.avg_service_time_seconds)
    return schemas.QueueStateOut(
        ticket=ticket,
        position=position,
        active_counters=active,
        estimated_wait_seconds=wait,
        service_name=service.name,
        visit_steps=service.visit_steps,
    )


def check_notify_thresholds(db: Session, service_id: str) -> None:
    """
    Called from every staff action that can shorten someone else's wait
    (call_next / complete_ticket / mark_no_show in staff.py) — those are
    the only events that ever move a threshold from "not yet crossed" to
    "crossed," so there's no need for a separate poller/cron job.

    For each waiting ticket in this service with unfired thresholds, fires
    send_push for any threshold the new estimate has dropped to or below,
    then records it as notified so it never fires twice.
    """
    service = db.query(models.Service).get(service_id)
    if not service:
        return
    active = _active_counters(db, service_id)

    # Filtered in Python, not SQL — a JSON-column inequality filter
    # (notify_thresholds != []) isn't portable: Postgres's plain `json`
    # type has no equality operator at all (would need jsonb). The
    # per-branch waiting list is small, so this isn't a hot path.
    waiting = (
        db.query(models.Ticket)
        .filter(
            models.Ticket.service_id == service_id,
            models.Ticket.status == models.TicketStatus.waiting,
        )
        .all()
    )
    for ticket in waiting:
        if not ticket.notify_thresholds:
            continue
        pending = [t for t in ticket.notify_thresholds if t not in ticket.notified_thresholds]
        if not pending:
            continue
        wait = estimate_wait_seconds(_position(db, ticket), active, service.avg_service_time_seconds)
        newly_crossed = [t for t in pending if wait <= t]
        if not newly_crossed:
            continue
        minutes = round(min(newly_crossed) / 60)
        send_push(
            db, ticket.phone, "Your wait is almost over",
            f"Ticket {ticket.number} — estimated wait is now about {minutes} min.",
        )
        ticket.notified_thresholds = ticket.notified_thresholds + newly_crossed
    db.commit()


@router.get("/citizens/{phone}/profile", response_model=schemas.ProfileAutofillOut)
def get_profile_autofill(phone: str, db: Session = Depends(get_db)):
    """
    Public by design — a citizen looks up their own saved details by the
    phone number they just typed, to autofill the "Get started" form on a
    repeat visit. Returns name/email only; see ProfileAutofillOut for why
    national_id is never exposed here.
    """
    profile = db.query(models.CitizenProfile).get(phone)
    if not profile:
        return schemas.ProfileAutofillOut()
    return profile


def _save_profile(db: Session, payload: schemas.TicketCreate) -> None:
    """Upsert the citizen's optional "Get started" details, only if they
    gave explicit consent — otherwise nothing is written, even if fields
    were filled in."""
    if not payload.consent_given:
        return
    if not (payload.full_name or payload.national_id or payload.email):
        return
    profile = db.query(models.CitizenProfile).get(payload.phone)
    if not profile:
        profile = models.CitizenProfile(phone=payload.phone)
        db.add(profile)
    if payload.full_name:
        profile.full_name = payload.full_name
    if payload.national_id:
        profile.national_id = payload.national_id
    if payload.email:
        profile.email = payload.email
    profile.consent_given = 1
    profile.consent_at = datetime.utcnow()


@router.post("/tickets", response_model=schemas.QueueStateOut)
async def create_ticket(payload: schemas.TicketCreate, db: Session = Depends(get_db)):
    service = db.query(models.Service).get(payload.service_id)
    if not service:
        raise HTTPException(404, "Service not found")

    _save_profile(db, payload)

    today_count = (
        db.query(models.Ticket).filter(models.Ticket.service_id == service.id).count()
    )
    prefix = "".join(w[0] for w in service.name.split()).upper()[:4] or "TKT"
    number = f"{prefix}-{today_count + 1:03d}"

    case = None
    step_index = 0
    if len(service.visit_steps) > 1:
        # Multi-visit service: resume this phone's open case instead of
        # starting a fresh one, so "join the queue again" for step 2 lands
        # on the right step rather than restarting the whole sequence.
        case = (
            db.query(models.Case)
            .filter(
                models.Case.service_id == service.id,
                models.Case.phone == payload.phone,
                models.Case.status == models.CaseStatus.in_progress,
            )
            .first()
        )
        if not case:
            case = models.Case(service_id=service.id, phone=payload.phone)
            db.add(case)
            db.flush()
        step_index = case.current_step

    ticket = models.Ticket(
        number=number,
        service_id=service.id,
        phone=payload.phone,
        case_id=case.id if case else None,
        step_index=step_index,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    state = build_queue_state(db, ticket)
    await manager.broadcast(service.id, {"type": "queue_update", "service_id": service.id})
    return state


@router.get("/tickets/{ticket_id}", response_model=schemas.QueueStateOut)
def get_ticket_state(ticket_id: str, db: Session = Depends(get_db)):
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    return build_queue_state(db, ticket)


@router.patch("/tickets/{ticket_id}/notify-thresholds", response_model=schemas.TicketOut)
def set_notify_thresholds(ticket_id: str, payload: schemas.NotifyThresholdsIn, db: Session = Depends(get_db)):
    """
    Citizen opts in to "notify me when the wait drops to X" instead of only
    the final "it's your turn" push. Resets notified_thresholds on every
    call — if a citizen changes their selection, a threshold they'd already
    crossed under the old selection shouldn't be silently suppressed under
    the new one.
    """
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if ticket.status != models.TicketStatus.waiting:
        raise HTTPException(400, "Can only set notify thresholds while waiting")

    ticket.notify_thresholds = sorted(set(payload.thresholds_seconds), reverse=True)
    ticket.notified_thresholds = []
    db.commit()
    db.refresh(ticket)
    return ticket


@router.websocket("/ws/services/{service_id}")
async def service_ws(websocket: WebSocket, service_id: str):
    """
    A client connects here to be pushed `queue_update` events for this
    service. The payload is intentionally just a signal ("something about
    this service's queue changed") rather than the full state — the client
    reacts by re-fetching its own ticket's state via GET /tickets/{id},
    which keeps this server simple (no per-connection ticket tracking) at
    the cost of one extra request per update. Fine at pilot scale.
    """
    await manager.connect(service_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # keep the connection open; we don't expect client messages
    except WebSocketDisconnect:
        manager.disconnect(service_id, websocket)
