"""
Database wiring. SQLite for local dev — zero setup, same SQLAlchemy ORM
and schema as PostgreSQL. Switching to Postgres for the pilot is a one-line
change to DATABASE_URL; no model or query code changes.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = "sqlite:///./queuesmart.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # needed only for SQLite + FastAPI's threaded requests
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
