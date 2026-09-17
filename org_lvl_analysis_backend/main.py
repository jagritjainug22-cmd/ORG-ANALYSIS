# main.py
import sys
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

_backend = Path(__file__).resolve().parent
_repo = _backend.parent
load_dotenv(_repo / "POSTGRES" / ".env")
load_dotenv(_backend / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

from routers.auth import router as auth_router
from routers.admin import router as admin_router
from routers.projects import router as projects_router
from routers.lifecycle import router as lifecycle_router
from routers.chat import router as chat_router
from routers.benchmark import router as benchmark_router

ALLOWED_ORIGINS = [
    "http://localhost:8501",
    "http://127.0.0.1:8501",
]
_extra_origins = os.environ.get("CORS_ORIGINS", "")
if _extra_origins:
    ALLOWED_ORIGINS.extend(o.strip() for o in _extra_origins.split(",") if o.strip())

# In dev, allow the frontend on any host/IP (e.g. VM IP for colleagues on the same network).
IS_PRODUCTION = os.environ.get("ENVIRONMENT") == "production"
CORS_ORIGIN_REGEX = None if IS_PRODUCTION else r"^https?://[\w.\-]+:8501$"


def _origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    if CORS_ORIGIN_REGEX and re.fullmatch(CORS_ORIGIN_REGEX, origin):
        return True
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from services import db_service

    # init_db() opens DB connections (blocking I/O) — run in thread pool
    # so the async event loop stays unblocked and can serve requests.
    await asyncio.to_thread(db_service.init_db)
    yield
    from services import duckdb_manager
    from services.pg_adapter import close_pool

    duckdb_manager.close()
    await asyncio.to_thread(close_pool)


app = FastAPI(title="Org Level Analysis Backend", lifespan=lifespan)

# Standard CORS middleware handles OPTIONS pre-flight and 2xx/3xx responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


class _CORSErrorMiddleware:
    """Pure ASGI middleware: inject CORS headers on error responses that the
    CORSMiddleware misses (e.g. 401/403/500 raised before headers are sent)."""

    def __init__(self, app):
        self._app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        origin = dict(scope.get("headers", [])).get(b"origin", b"").decode()

        if not _origin_allowed(origin):
            await self._app(scope, receive, send)
            return

        async def patched_send(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                names = {h[0].lower() for h in headers}
                if b"access-control-allow-origin" not in names:
                    headers.append((b"access-control-allow-origin", origin.encode()))
                    headers.append((b"access-control-allow-credentials", b"true"))
                    headers.append((b"vary", b"Origin"))
                    message = {**message, "headers": headers}
            await send(message)

        await self._app(scope, receive, patched_send)


app.add_middleware(_CORSErrorMiddleware)

# --- Routers ---
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(projects_router)
app.include_router(lifecycle_router)
app.include_router(chat_router)
app.include_router(benchmark_router)

# Paths that do not require a Bearer token (Swagger + runtime).
_PUBLIC_PATHS = {"/", "/auth/login", "/auth/refresh"}


def custom_openapi():
    """Add Bearer JWT security to OpenAPI so Swagger UI shows Authorize."""
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=app.title,
        version="1.0.0",
        description=(
            "OrgSight backend API. Use **Authorize** with the `access_token` "
            "from `POST /auth/login` (paste the token only, without `Bearer`)."
        ),
        routes=app.routes,
    )
    openapi_schema.setdefault("components", {})["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "JWT access token from POST /auth/login (15 min TTL)",
        }
    }

    for path, path_item in openapi_schema.get("paths", {}).items():
        if path in _PUBLIC_PATHS:
            continue
        for operation in path_item.values():
            if isinstance(operation, dict):
                operation["security"] = [{"BearerAuth": []}]

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/")
def root():
    return {"status": "ok", "message": "Org Level Analysis Backend running"}
