"""
Citizen history: everything a phone number has ever queued for, split into
multi-visit Cases (shown as a timeline) and ordinary single-visit tickets.
Looked up by phone rather than a login, matching the rest of the app's
no-account design — a real deployment would gate this behind the same OTP
used to join a queue, so a phone number can't be used to snoop on someone
else's history.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter()


@router.get("/citizens/{phone}/history", response_model=schemas.HistoryOut)
def get_history(phone: str, db: Session = Depends(get_db)):
    cases = (
        db.query(models.Case)
        .filter(models.Case.phone == phone)
        .order_by(models.Case.created_at.desc())
        .all()
    )
    case_outs = []
    for case in cases:
        service = db.query(models.Service).get(case.service_id)
        case_outs.append(
            schemas.CaseOut(
                id=case.id,
                service_id=case.service_id,
                service_name=service.name,
                status=case.status,
                current_step=case.current_step,
                visit_steps=service.visit_steps,
                created_at=case.created_at,
                tickets=case.tickets,
            )
        )

    single_tickets = (
        db.query(models.Ticket)
        .filter(models.Ticket.phone == phone, models.Ticket.case_id.is_(None))
        .order_by(models.Ticket.issued_at.desc())
        .all()
    )
    single_outs = []
    for t in single_tickets:
        out = schemas.TicketOut.model_validate(t)
        out.service_name = t.service.name
        single_outs.append(out)

    return schemas.HistoryOut(cases=case_outs, single_visit_tickets=single_outs)
