# main.py
import sys
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.auth import router as auth_router
from routers.admin import router as admin_router
from routers.projects import router as projects_router
from routers.lifecycle import router as lifecycle_router

app = FastAPI(title="Org Level Analysis Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5175", "http://127.0.0.1:5175"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# --- Routers ---
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(projects_router)
app.include_router(lifecycle_router)


@app.get("/")
def root():
    return {"status": "ok", "message": "Org Level Analysis Backend running"}
