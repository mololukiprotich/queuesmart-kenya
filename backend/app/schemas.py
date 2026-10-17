"""
Pydantic schemas — the API's request/response contracts. Kept separate from
the SQLAlchemy models on purpose: the DB model carries internal fields
(e.g. completed_count) that should never leak into an API response, and the
response needs computed fields (position, estimated_wait_seconds) that don't
exist as columns at all.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models import TicketStatus, CaseStatus, Role


class BranchOut(BaseModel):
    id: str
    name: str
    address: Optional[str] = None

    class Config:
        from_attributes = True


class ServiceOut(BaseModel):
    id: str
    branch_id: str
    name: str
    avg_service_time_seconds: float
    visit_steps: list[str]

    class Config:
        from_attributes = True


class CounterOut(BaseModel):
    id: str
    branch_id: str
    label: str
    service_ids: list[str]

    class Config:
        from_attributes = True


class TicketCreate(BaseModel):
    service_id: str
    phone: str
    full_name: Optional[str] = None
    national_id: Optional[str] = None
    email: Optional[str] = None
    consent_given: bool = False


class ProfileAutofillOut(BaseModel):
    """What the citizen's own "Get started" form may read back for autofill.
    Deliberately excludes national_id — a lookup-by-phone endpoint is public
    (no OTP yet, see queue.py), so it must never be a way to fish for ID
    numbers by guessing phone numbers."""
    full_name: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True


class ProfileAdminOut(BaseModel):
    """Full profile incl. national_id — admin-only, see admin.py."""
    phone: str
    full_name: Optional[str] = None
    national_id: Optional[str] = None
    email: Optional[str] = None
    consent_given: bool
    consent_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TicketOut(BaseModel):
    id: str
    number: str
    service_id: str
    service_name: Optional[str] = None
    phone: str
    status: TicketStatus
    case_id: Optional[str] = None
    step_index: int
    issued_at: datetime
    called_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class QueueStateOut(BaseModel):
    """What a citizen's client polls/subscribes to for one ticket."""
    ticket: TicketOut
    position: int  # 1-indexed; 0 once called
    active_counters: int
    estimated_wait_seconds: float
    service_name: str
    visit_steps: list[str]


class CaseOut(BaseModel):
    id: str
    service_id: str
    service_name: str
    status: CaseStatus
    current_step: int
    visit_steps: list[str]
    created_at: datetime
    tickets: list[TicketOut]

    class Config:
        from_attributes = True


class HistoryOut(BaseModel):
    """A citizen's full history: multi-visit cases with their step timeline,
    plus standalone single-visit tickets, newest first."""
    cases: list[CaseOut]
    single_visit_tickets: list[TicketOut]


class CallNextOut(BaseModel):
    ticket: Optional[TicketOut] = None
    message: str


class ServiceStatOut(BaseModel):
    service_id: str
    service_name: str
    waiting_count: int
    active_counters: int
    avg_service_time_seconds: float
    served_today: int
    no_show_count: int  # cumulative, not day-scoped — see admin.py


class AdminStatsOut(BaseModel):
    served_today: int
    waiting_now: int
    no_show_rate: float  # 0..1, cumulative no-shows vs. completions
    services: list[ServiceStatOut]


class TimeseriesPointOut(BaseModel):
    label: str  # e.g. "09:00"
    completed: int


class TimeseriesOut(BaseModel):
    points: list[TimeseriesPointOut]


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    phone: str
    endpoint: str
    keys: PushKeys


class VapidPublicKeyOut(BaseModel):
    public_key: str


class OtpRequestIn(BaseModel):
    phone: str


class OtpRequestOut(BaseModel):
    status: str  # "sent" (real WhatsApp message) or "dev_mode" (no WhatsApp creds configured)
    debug_code: Optional[str] = None  # only populated in dev_mode — never set once WhatsApp is configured


class OtpVerifyIn(BaseModel):
    phone: str
    code: str


class OtpVerifyOut(BaseModel):
    token: str
    phone: str


class SessionCheckOut(BaseModel):
    phone: str


class LoginRequest(BaseModel):
    username: str
    password: str


class StaffOut(BaseModel):
    id: str
    name: Optional[str] = None
    username: Optional[str] = None
    role: Role
    branch_id: Optional[str] = None

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    token: str
    staff: StaffOut
