from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.config import settings
from app.routers import admin, courses, health, lessons, me, teacher, webhooks
from app.services.mux import MuxNotConfigured

app = FastAPI(title="LMS API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

app.include_router(health.router, prefix="/api/v1")
app.include_router(courses.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
app.include_router(lessons.router, prefix="/api/v1")
app.include_router(teacher.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(webhooks.router, prefix="/api/v1")


@app.exception_handler(MuxNotConfigured)
async def mux_not_configured(_request: Request, exc: MuxNotConfigured) -> JSONResponse:
    return JSONResponse(status_code=501, content={"detail": exc.detail})


@app.exception_handler(OperationalError)
async def database_unavailable(_request: Request, _exc: OperationalError) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": "Database connection failed. Check DATABASE_URL."},
    )
