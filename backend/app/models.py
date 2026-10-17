"""
The five entities that carry the whole system. Kept deliberately small —
see the design note at the bottom of each class for why it's shaped this way.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Float, Integer, ForeignKey, DateTime, Enum, JSON
from sqlalchemy.orm import relationship

from app.database import Base


def gen_id() -> str:
    return uuid.uuid4().hex[:12]


class Role(str, enum.Enum):
    citizen = "citizen"
    agent = "agent"
    supervisor = "supervisor"
    admin = "admin"


class TicketStatus(str, enum.Enum):
    waiting = "waiting"
    called = "called"
    serving = "serving"
    done = "done"
    no_show = "no_show"
    cancelled = "cancelled"


class Branch(Base):
    """A physical Huduma Centre location."""
    __tablename__ = "branches"

    id = Column(String, primary_key=True, default=gen_id)
    name = Column(String, nullable=False)
    address = Column(String, nullable=True)

    services = relationship("Service", back_populates="branch", cascade="all, delete-orphan")
    counters = relationship("Counter", back_populates="branch", cascade="all, delete-orphan")


def default_visit_steps():
    return ["Visit"]


class Service(Base):
    """
    A service offered at a branch (ID replacement, passport renewal, NHIF...).
    avg_service_time_seconds is a rolling average recomputed every time a
    ticket for this service completes — it's the input to the wait estimator.
    Starts at a sane default (10 min) so day-one estimates aren't zero/garbage
    before any real tickets have completed.

    visit_steps names the sequence of counter visits this service requires —
    most services are a single visit (["Visit"]), but some (passport renewal)
    genuinely can't be finished in one trip. A Case ties a citizen's tickets
    across that sequence together; see Case below.
    """
    __tablename__ = "services"

    id = Column(String, primary_key=True, default=gen_id)
    branch_id = Column(String, ForeignKey("branches.id"), nullable=False)
    name = Column(String, nullable=False)
    avg_service_time_seconds = Column(Float, default=600.0, nullable=False)
    completed_count = Column(Integer, default=0, nullable=False)  # used to weight the rolling average
    no_show_count = Column(Integer, default=0, nullable=False)
    visit_steps = Column(JSON, default=default_visit_steps, nullable=False)

    branch = relationship("Branch", back_populates="services")
    tickets = relationship("Ticket", back_populates="service", cascade="all, delete-orphan")


class Counter(Base):
    """
    A staffed window. service_ids is a JSON list rather than its own join
    table — a counter's service assignment changes per-shift, not something
    we need to query/filter across relationally, so a join table would be
    overhead without benefit for this project's scale.
    """
    __tablename__ = "counters"

    id = Column(String, primary_key=True, default=gen_id)
    branch_id = Column(String, ForeignKey("branches.id"), nullable=False)
    label = Column(String, nullable=False)
    service_ids = Column(JSON, default=list, nullable=False)

    branch = relationship("Branch", back_populates="counters")


class CaseStatus(str, enum.Enum):
    in_progress = "in_progress"
    completed = "completed"


class Case(Base):
    """
    A citizen's journey through a multi-visit service (e.g. passport renewal:
    submit documents -> biometrics -> collection). Each visit is still a
    normal Ticket that goes through the normal queue — a Case just threads
    those tickets together so the citizen (and admin) can see the whole
    sequence, and so joining the queue again for the same service resumes
    at the next step instead of starting over.
    """
    __tablename__ = "cases"

    id = Column(String, primary_key=True, default=gen_id)
    service_id = Column(String, ForeignKey("services.id"), nullable=False)
    phone = Column(String, nullable=False)
    status = Column(Enum(CaseStatus), default=CaseStatus.in_progress, nullable=False)
    current_step = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    service = relationship("Service")
    tickets = relationship("Ticket", back_populates="case", order_by="Ticket.step_index")


class Ticket(Base):
    """
    One citizen's place in line. The timestamp trail (issued/called/completed)
    is logged in full even though v1's estimator only needs the aggregate —
    that history is also exactly what a future ML wait-predictor would train on.

    case_id/step_index are null/0 for ordinary single-visit services; for a
    multi-visit service this ticket represents one step of the parent Case.
    """
    __tablename__ = "tickets"

    id = Column(String, primary_key=True, default=gen_id)
    number = Column(String, nullable=False)  # human-readable, e.g. "NHIF-014"
    service_id = Column(String, ForeignKey("services.id"), nullable=False)
    phone = Column(String, nullable=False)
    status = Column(Enum(TicketStatus), default=TicketStatus.waiting, nullable=False)
    case_id = Column(String, ForeignKey("cases.id"), nullable=True)
    step_index = Column(Integer, default=0, nullable=False)

    issued_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    called_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    service = relationship("Service", back_populates="tickets")
    case = relationship("Case", back_populates="tickets")


class CitizenProfile(Base):
    """
    Optional details a citizen gives once, at "Get started" time, so return
    visits can autofill instead of re-typing. Kept in its own table — not
    folded onto Ticket/Case — specifically so routine queue/staff endpoints
    (TicketOut, counter_queue, call-next, admin stats) never touch it: an
    agent calling the next number sees a ticket number and phone, nothing
    more. national_id is the one sensitive field here, so it gets its own
    column rather than a generic JSON blob, making it trivial to grep for
    every place in the codebase that is allowed to read it (currently: just
    the admin-only profile lookup in admin.py).

    phone is the primary key: one profile per phone number, upserted on
    every "Get started" submission so the latest details win.
    """
    __tablename__ = "citizen_profiles"

    phone = Column(String, primary_key=True)
    full_name = Column(String, nullable=True)
    national_id = Column(String, nullable=True)
    email = Column(String, nullable=True)
    consent_given = Column(Integer, default=0, nullable=False)  # 0/1 — explicit consent to store the above
    consent_at = Column(DateTime, nullable=True)
    phone_verified = Column(Integer, default=0, nullable=False)  # 0/1 — set once the phone passes WhatsApp OTP
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class CitizenSession(Base):
    """
    A device's "remember me" session, created once a phone number passes
    WhatsApp OTP verification. The frontend keeps the token in localStorage
    so a returning citizen skips both the OTP round-trip and re-typing their
    details — see push/queue.py autofill for the no-auth version of this;
    this is the verified version.

    Deliberately a DB table, not the in-memory dict staff sessions use (see
    auth.py) — staff sessions are meant to die on restart (one login per
    shift); a citizen's "I verified my phone once" should survive one.
    No expiry enforced yet — a pilot should add a TTL (e.g. 90 days) and a
    revoke-all-sessions admin action before relying on this for anything
    more sensitive than autofill convenience.
    """
    __tablename__ = "citizen_sessions"

    token = Column(String, primary_key=True)
    phone = Column(String, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class PushSubscription(Base):
    """
    A browser's Web Push subscription, keyed to the phone number the citizen
    typed when subscribing — not to a single ticket, so the same subscription
    keeps working across a citizen's whole visit (and future visits) without
    re-subscribing every time a new ticket is issued.

    endpoint is unique per browser install; a citizen re-subscribing from the
    same browser (e.g. after reinstalling the PWA) just replaces the row via
    upsert-by-endpoint rather than accumulating duplicates.
    """
    __tablename__ = "push_subscriptions"

    id = Column(String, primary_key=True, default=gen_id)
    phone = Column(String, nullable=False, index=True)
    endpoint = Column(String, unique=True, nullable=False)
    p256dh = Column(String, nullable=False)
    auth = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class User(Base):
    """
    Citizens and staff share one table distinguished by role. A citizen row
    is created lazily on first OTP request; staff rows are pre-provisioned
    by an admin. branch_id is null for citizens (they're not tied to one branch).

    username/password_hash are only set for staff rows — citizens never get
    a password, they authenticate by phone/OTP. The hash here is a plain
    SHA-256 (see auth.py) purely to keep the prototype dependency-free;
    a pilot deployment must swap this for bcrypt/argon2 before go-live.
    """
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_id)
    phone = Column(String, unique=True, nullable=False)
    role = Column(Enum(Role), default=Role.citizen, nullable=False)
    branch_id = Column(String, ForeignKey("branches.id"), nullable=True)
    name = Column(String, nullable=True)
    username = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)
