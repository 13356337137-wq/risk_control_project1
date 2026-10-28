"""后端工程入口。本阶段尚未接入数据库和业务路由。"""
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI

from config import settings
from helpers.logging_config import configure_logging

logger = logging.getLogger("risk_control")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.log_level)
    logger.info("工程骨架启动；数据库与任务接口尚未接入。")
    try:
        yield
    finally:
        logger.info("服务已停止。")


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level=settings.log_level.lower(),
    )
