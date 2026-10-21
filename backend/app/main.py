"""
App entrypoint: creates tables, seeds one demo branch so the frontend has
something to point at immediately, and wires the two routers.

Split into queue.py (citizen) and staff.py (agent) rather than one file —
they're genuinely different audiences hitting different endpoints, and
keeping them apart makes it obvious, when defending the design, which
endpoints are "public" (any citizen) vs. which would need staff auth
enforced before a real pilot.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine, SessionLocal
from app import models
from app.routers import queue, staff, history, admin, otp
from app.auth import hash_password

Base.metadata.create_all(bind=engine)

app = FastAPI(title="QueueSmart Kenya API")

# FRONTEND_ORIGINS: comma-separated list, e.g. "https://frontend-ebon-pi-95.vercel.app".
# Unset (dev default) keeps the wildcard; set it once the real frontend URL
# is known so a hosted deployment isn't wide open to any origin.
_origins_env = os.environ.get("FRONTEND_ORIGINS")
allow_origins = [o.strip() for o in _origins_env.split(",")] if _origins_env else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(queue.router, prefix="/api", tags=["citizen"])
app.include_router(otp.router, prefix="/api", tags=["otp"])
app.include_router(staff.router, prefix="/api/staff", tags=["staff"])
app.include_router(history.router, prefix="/api", tags=["history"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])


def seed():
    db = SessionLocal()
    try:
        if db.query(models.Branch).count() > 0:
            return
        branch = models.Branch(
            name="Huduma Centre GPO", address="GPO, Nairobi",
            latitude=-1.2864, longitude=36.8172,  # real coordinates, GPO Nairobi
        )
        db.add(branch)
        db.flush()

        nhif = models.Service(branch_id=branch.id, name="NHIF Registration", avg_service_time_seconds=420)
        id_svc = models.Service(branch_id=branch.id, name="ID Replacement", avg_service_time_seconds=600)
        # Passport renewal is a real multi-visit service — a citizen cannot
        # finish it in one counter trip, which is exactly what the Case
        # model exists to represent (see models.py).
        passport = models.Service(
            branch_id=branch.id,
            name="Passport Renewal",
            avg_service_time_seconds=900,
            visit_steps=["Document Submission", "Biometrics Capture", "Collection"],
        )
        db.add_all([nhif, id_svc, passport])
        db.flush()

        counter1 = models.Counter(branch_id=branch.id, label="Counter 1", service_ids=[nhif.id, id_svc.id])
        counter2 = models.Counter(branch_id=branch.id, label="Counter 2", service_ids=[passport.id])
        db.add_all([counter1, counter2])

        # Demo staff accounts — see auth.py for why this is prototype-grade,
        # not pilot-grade, auth. An agent can run the counter console; only
        # a supervisor/admin account can see the admin dashboard.
        agent = models.User(
            phone="+254700100100", role=models.Role.agent, branch_id=branch.id,
            name="John Mwangi", username="agent1", password_hash=hash_password("agent123"),
        )
        supervisor = models.User(
            phone="+254700200200", role=models.Role.supervisor, branch_id=branch.id,
            name="Grace Wanjiru", username="supervisor1", password_hash=hash_password("super123"),
        )
        db.add_all([agent, supervisor])
        db.commit()
    finally:
        db.close()


seed()


@app.get("/api/health")
def health():
    return {"status": "ok"}
