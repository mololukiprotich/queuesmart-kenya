"""
Web Push — free notification channel (no SMS gateway, no per-message cost).
Uses the browser's native Push API via VAPID auth, so delivery goes straight
through the browser vendor's push service (Chrome -> FCM, Firefox -> Mozilla's,
etc.) at no cost to us regardless of volume.

vapid_private.pem is dev-only, generated once for this prototype. Before a
real pilot: generate a fresh keypair and load the private key from an env
var / secrets manager instead of a file checked next to the code.
"""
import json
import os

from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session

from app import models

_KEY_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "vapid_private.pem")

VAPID_PUBLIC_KEY_B64URL = "BOfag50FvRxL4UIPlYAEo8R8R7lJLq27ppBJ5Y2uXLy7MNdmkzDnrG3-KYQYm8kwlhu-nt-DZj4a-yudr0f2JGQ"
VAPID_CLAIMS = {"sub": "mailto:admin@queuesmart.ke"}


def send_push(db: Session, phone: str, title: str, body: str) -> None:
    """
    Best-effort — a citizen may have zero subscriptions (never opted in, or
    on a browser that doesn't support push) and that's a normal, silent
    no-op, not an error. A subscription that the push service reports as
    gone (410/404 — uninstalled, permissions revoked) is deleted so we stop
    wasting calls on it.
    """
    subs = db.query(models.PushSubscription).filter(models.PushSubscription.phone == phone).all()
    if not subs:
        return

    payload = json.dumps({"title": title, "body": body})
    dead_ids = []
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=_KEY_PATH,  # pywebpush accepts a file path directly
                vapid_claims=dict(VAPID_CLAIMS),
            )
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):
                dead_ids.append(sub.id)
            # other failures (network blip, rate limit) are left alone to retry next time
        except Exception:
            # A notification failure must never take down the staff action
            # (call-next) that triggered it — this is a nice-to-have layered
            # on top of the WebSocket live-update flow, never load-bearing.
            pass

    if dead_ids:
        db.query(models.PushSubscription).filter(models.PushSubscription.id.in_(dead_ids)).delete(
            synchronize_session=False
        )
        db.commit()
