"""
Minimal staff auth — intentionally NOT production-grade. It exists to gate
the staff console and admin dashboard behind a login during the pilot
prototype, not to be a real identity system.

Real deployment would need: bcrypt/argon2 instead of SHA-256, JWTs (or
server sessions in Postgres) instead of an in-memory token dict that forgets
everyone on restart, and rate-limiting on login attempts. Flagging this
explicitly rather than dressing it up as more secure than it is.
"""
import hashlib
import secrets

from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.database import get_db
from app import models

# token -> user_id. In-memory by design for a prototype: simple, and it
# naturally logs everyone out on server restart rather than accumulating
# stale sessions in the database.
_sessions: dict[str, str] = {}


def hash_password(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def create_session(user_id: str) -> str:
    token = secrets.token_hex(24)
    _sessions[token] = user_id
    return token


def get_current_staff(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ")
    user_id = _sessions.get(token)
    if not user_id:
        raise HTTPException(401, "Invalid or expired session")
    user = db.query(models.User).get(user_id)
    if not user or user.role == models.Role.citizen:
        raise HTTPException(401, "Invalid session")
    return user


def require_admin(user: models.User = Depends(get_current_staff)) -> models.User:
    if user.role not in (models.Role.supervisor, models.Role.admin):
        raise HTTPException(403, "Admin access required")
    return user


def require_admin_only(user: models.User = Depends(get_current_staff)) -> models.User:
    """
    Stricter than require_admin: excludes supervisors. Reserved for personal
    data (national ID, email) that a branch supervisor has no operational
    need to see — only this admin role, used sparingly, can pull that up.
    """
    if user.role != models.Role.admin:
        raise HTTPException(403, "Admin access required")
    return user
