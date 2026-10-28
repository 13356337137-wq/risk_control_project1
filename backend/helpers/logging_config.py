"""控制台日志，时间统一使用 UTC+8。"""
import logging
import time
from datetime import datetime, timedelta, timezone

CHINA_TZ = timezone(timedelta(hours=8))


def china_time(timestamp: float) -> time.struct_time:
    return datetime.fromtimestamp(timestamp, CHINA_TZ).timetuple()


class ChinaTimeFormatter(logging.Formatter):
    converter = staticmethod(china_time)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(
        ChinaTimeFormatter(
            fmt="%(asctime)s+08:00 %(levelname)s %(name)s: %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
    )
    logging.basicConfig(level=level, handlers=[handler], force=True)
