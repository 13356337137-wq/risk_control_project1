"""数据库连接与会话；启动时自动建库建表。"""
from __future__ import annotations

import os
from collections.abc import Iterator

import pymysql
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "root")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DB = os.getenv("MYSQL_DB", "risk_control")


def ensure_database() -> None:
    conn = pymysql.connect(host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER, password=MYSQL_PASSWORD)
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{MYSQL_DB}` "
                "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
            )
        conn.commit()
    finally:
        conn.close()


def _url() -> str:
    return (
        f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}"
        "?charset=utf8mb4"
    )


ensure_database()
engine = create_engine(_url(), pool_pre_ping=True, pool_recycle=1800, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()

