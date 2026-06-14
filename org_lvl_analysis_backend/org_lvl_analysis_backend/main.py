# main.py
import sys
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

_backend = Path(__file__).resolve().parent
_repo = _backend.parent.parent
load_dotenv(_repo / "POSTGRES" / ".env")
load_dotenv(_backend / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from routers.auth import router as auth_router
from routers.admin import router as admin_router
from routers.projects import router as projects_router
from routers.lifecycle import router as lifecycle_router

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from services import db_service

    # init_db() opens DB connections (blocking I/O) — run in thread pool
    # so the async event loop stays unblocked and can serve requests.
    await asyncio.to_thread(db_service.init_db)
    yield
    from services.pg_adapter import close_pool

    await asyncio.to_thread(close_pool)


app = FastAPI(title="Org Level Analysis Backend", lifespan=lifespan)

# Standard CORS middleware handles OPTIONS pre-flight and 2xx/3xx responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
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

        if origin not in ALLOWED_ORIGINS:
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


@app.get("/")
def root():
    return {"status": "ok", "message": "Org Level Analysis Backend running"}
