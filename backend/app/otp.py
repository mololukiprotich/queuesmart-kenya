"""
OTP code lifecycle — in-memory by design, same prototype trade-off as
auth.py's staff `_sessions` dict: simple, and a restart naturally clears
every pending code rather than accumulating stale ones. A real pilot should
move this to Redis with the same TTL semantics so codes survive a rolling
deploy and work across more than one backend process.

Rate limits exist specifically because this endpoint is unauthenticated by
nature (you don't have an account yet, that's the point of OTP) — without
them it's a free SMS/WhatsApp-bombing-as-a-service against any phone number.
"""
import random
import secrets
from datetime import datetime, timedelta

OTP_TTL_SECONDS = 300
RESEND_COOLDOWN_SECONDS = 30
MAX_VERIFY_ATTEMPTS = 5

_codes: dict[str, dict] = {}  # phone -> {code, expires_at, attempts, last_sent_at}


class OnCooldown(Exception):
    """Raised instead of silently re-sending — lets the caller return a 429
    with a clear "wait N seconds" message rather than the citizen getting
    confused by a new code invalidating one still in transit on WhatsApp."""
    def __init__(self, retry_after: int):
        self.retry_after = retry_after


def request_code(phone: str) -> str:
    now = datetime.utcnow()
    existing = _codes.get(phone)
    if existing:
        elapsed = (now - existing["last_sent_at"]).total_seconds()
        if elapsed < RESEND_COOLDOWN_SECONDS:
            raise OnCooldown(retry_after=int(RESEND_COOLDOWN_SECONDS - elapsed))

    code = f"{random.randint(0, 999999):06d}"
    _codes[phone] = {
        "code": code,
        "expires_at": now + timedelta(seconds=OTP_TTL_SECONDS),
        "attempts": 0,
        "last_sent_at": now,
    }
    return code


def verify_code(phone: str, submitted: str) -> bool:
    entry = _codes.get(phone)
    if not entry:
        return False
    if datetime.utcnow() > entry["expires_at"]:
        _codes.pop(phone, None)
        return False
    if entry["attempts"] >= MAX_VERIFY_ATTEMPTS:
        _codes.pop(phone, None)  # burn it — force a fresh request_code() after too many wrong guesses
        return False

    entry["attempts"] += 1
    if secrets.compare_digest(entry["code"], submitted):
        _codes.pop(phone, None)
        return True
    return False
