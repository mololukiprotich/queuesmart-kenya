"""
Database wiring. SQLite for local dev — zero setup, same SQLAlchemy ORM
and schema as PostgreSQL. Reads DATABASE_URL from the environment so a
hosted deployment (Render, etc.) just sets that var to a real Postgres
connection string; falls back to local SQLite when unset.

Render's own Postgres gives you a URL starting "postgres://" — SQLAlchemy
2.x requires the "postgresql://" scheme, so that prefix is rewritten below
rather than asking every deployer to remember to edit the string by hand.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./queuesmart.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# check_same_thread is SQLite-only (FastAPI's threaded requests need it);
# Postgres connections don't take that kwarg at all.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
