"""
Citizen phone verification via WhatsApp OTP — layered on top of the
existing no-auth queue flow (see queue.py's docstring), not a replacement
for it. A citizen can still get a ticket with just a typed phone number;
verifying additionally unlocks a persisted session (see models.CitizenSession)
so a returning, verified citizen skips re-typing everything.
"""
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app import otp as otp_store
from app.whatsapp import send_otp, configured as whatsapp_configured

router = APIRouter()


@router.post("/otp/request", response_model=schemas.OtpRequestOut)
def request_otp(payload: schemas.OtpRequestIn):
    try:
        code = otp_store.request_code(payload.phone)
    except otp_store.OnCooldown as e:
        raise HTTPException(429, f"Please wait {e.retry_after}s before requesting another code")

    delivered = send_otp(payload.phone, code)
    if delivered:
        return schemas.OtpRequestOut(status="sent")

    if whatsapp_configured():
        # Credentials exist but the send genuinely failed (bad number, API
        # outage, template not approved yet) — don't leak the code in that
        # case, that would defeat the point of OTP the moment WhatsApp is
        # live.
        raise HTTPException(502, "Could not send WhatsApp message — check the number and try again")

    # No WhatsApp credentials configured at all: this is a dev/demo
    # environment, not a real deployment. Return the code directly so the
    # flow is testable end-to-end. See whatsapp.py's docstring — this path
    # must be impossible once real credentials are set, which the check
    # above guarantees.
    return schemas.OtpRequestOut(status="dev_mode", debug_code=code)


@router.post("/otp/verify", response_model=schemas.OtpVerifyOut)
def verify_otp(payload: schemas.OtpVerifyIn, db: Session = Depends(get_db)):
    if not otp_store.verify_code(payload.phone, payload.code):
        raise HTTPException(400, "Invalid or expired code")

    token = secrets.token_hex(24)
    db.add(models.CitizenSession(token=token, phone=payload.phone))

    profile = db.query(models.CitizenProfile).get(payload.phone)
    if not profile:
        profile = models.CitizenProfile(phone=payload.phone)
        db.add(profile)
    profile.phone_verified = 1

    db.commit()
    return schemas.OtpVerifyOut(token=token, phone=payload.phone)


@router.get("/otp/session", response_model=schemas.SessionCheckOut)
def check_session(x_session_token: str = Header(...), db: Session = Depends(get_db)):
    """The frontend calls this on load with whatever token it has in
    localStorage, to confirm it's still valid before trusting it for
    autofill — a token could be stale if an admin ever adds session
    revocation later."""
    session = db.query(models.CitizenSession).get(x_session_token)
    if not session:
        raise HTTPException(401, "Invalid or expired session")
    return schemas.SessionCheckOut(phone=session.phone)
