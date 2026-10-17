"""
WhatsApp Cloud API sender for OTP codes — the free/near-free verification
channel chosen over SMS (see the earlier design discussion: Africa's Talking
has no real-delivery free tier, WhatsApp does via free service conversations
and cheap template messages, and has very high penetration in Kenya).

Setup required on Meta's side before this works for real (none of this is
creatable via API — it's a one-time console setup):
  1. A WhatsApp Business app in Meta for Developers, with the Cloud API
     product added.
  2. A verified sending number, giving you WHATSAPP_PHONE_NUMBER_ID.
  3. A permanent access token (System User token, not the 24h test token),
     giving you WHATSAPP_ACCESS_TOKEN.
  4. An approved message template in the "Authentication" category — Meta
     requires pre-approved templates for business-initiated messages; you
     cannot send free-form "your code is 123456" text on the first contact.
     Name it to match WHATSAPP_OTP_TEMPLATE_NAME (default "otp_code"), body
     text e.g. "{{1}} is your QueueSmart Kenya verification code. Valid for
     5 minutes." — submit for approval in Meta Business Manager, this
     usually clears in minutes to a few hours.

Until those env vars are set, `configured()` is False and send_otp() is a
no-op that returns False — the caller (routers/otp.py) falls back to
returning the code directly in the API response so the flow is still fully
testable end-to-end without real WhatsApp credentials. That dev fallback
must never ship enabled in a real deployment — it exists purely so this
code is runnable right now.
"""
import os

import requests

WHATSAPP_ACCESS_TOKEN = os.environ.get("WHATSAPP_ACCESS_TOKEN")
WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID")
WHATSAPP_OTP_TEMPLATE_NAME = os.environ.get("WHATSAPP_OTP_TEMPLATE_NAME", "otp_code")
WHATSAPP_OTP_LANG = os.environ.get("WHATSAPP_OTP_LANG", "en_US")
GRAPH_API_VERSION = "v21.0"


def configured() -> bool:
    return bool(WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID)


def send_otp(phone: str, code: str) -> bool:
    """Returns True only on a confirmed 200 from the Graph API. Any
    misconfiguration, network failure, or rejection returns False rather
    than raising — the caller decides what to do (dev fallback, or surface
    an error to the citizen) rather than this module crashing a request
    over a WhatsApp outage."""
    if not configured():
        return False

    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages"
    headers = {
        "Authorization": f"Bearer {WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": phone.lstrip("+"),  # Graph API wants digits only, no leading +
        "type": "template",
        "template": {
            "name": WHATSAPP_OTP_TEMPLATE_NAME,
            "language": {"code": WHATSAPP_OTP_LANG},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": code}]},
            ],
        },
    }
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=10)
        return resp.status_code == 200
    except requests.RequestException:
        return False
