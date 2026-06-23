"""
Projects router -- user-facing endpoints.

Lists the current user's assigned projects, provides project details
with deadline warnings, and manages soft locks (Phase 6).
"""

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request

from dependencies.auth import get_current_user, require_project_access
from services import project_service, lock_service
from services.audit_service import write_audit_log

router = APIRouter(prefix="/projects", tags=["projects"])

DEADLINE_WARNING_HOURS = int(os.environ.get("DEADLINE_WARNING_HOURS", "72"))


def _deadline_info(project: dict) -> dict:
    """Compute deadline warning fields for a project."""
    if not project.get("deadline"):
        return {"deadline_warning": False, "hours_until_deadline": None}
    try:
        dl = datetime.fromisoformat(project["deadline"].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        dl = datetime.strptime(project["deadline"][:10], "%Y-%m-%d")
    now = datetime.utcnow()
    delta = dl - now
    hours_left = delta.total_seconds() / 3600
    return {
        "deadline_warning": 0 < hours_left <= DEADLINE_WARNING_HOURS,
        "hours_until_deadline": round(hours_left, 1),
    }


@router.get("")
async def list_my_projects(user: dict = Depends(get_current_user)):
    """List projects assigned to the current user. Admins see all.

    Augments each project with deadline warnings, lock status, team
    member preview, and dataset count -- everything the project picker
    needs to render rich cards/rows in one round-trip.
    """
    is_admin = (user["role"] == "admin")
    projects = project_service.list_projects_with_metadata(user["id"], is_admin=is_admin)
    return [{**p, **_deadline_info(p)} for p in projects]


@router.get("/{project_id}")
async def get_project_detail(
    project_id: int,
    user: dict = Depends(require_project_access()),
):
    """Get project details with deadline warnings and lock status."""
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    assignments = project_service.list_project_assignments(project_id)
    lock = lock_service.get_lock(project_id)

    return {
        **project,
        **_deadline_info(project),
        "locked_by": lock["username"] if lock else None,
        "locked_by_id": lock["user_id"] if lock else None,
        "members": [
            {
                "user_id": a["user_id"],
                "username": a["username"],
                "display_name": a["display_name"],
                "role": a["role"],
                "assigned_at": a["assigned_at"],
            }
            for a in assignments
        ],
    }


# ---------------------------------------------------------------------------
# Soft locks (Phase 6)
# ---------------------------------------------------------------------------

@router.post("/{project_id}/lock")
async def acquire_lock(
    project_id: int,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Attempt to acquire the soft lock for a project."""
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    result = lock_service.acquire_lock(project_id, user["id"], user["username"])

    if result["acquired"]:
        write_audit_log(
            user_id=user["id"],
            action="project.lock_acquired",
            resource_type="project",
            resource_id=project_id,
            ip_address=request.client.host if request.client else None,
        )
    return result


@router.post("/{project_id}/lock/heartbeat")
async def lock_heartbeat(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    """Refresh lock heartbeat. No audit logging -- high frequency.
    Auto-reacquires if lock expired between heartbeats."""
    result = lock_service.heartbeat(project_id, user["id"], username=user["username"])
    if result is None:
        raise HTTPException(404, detail="No active lock held by you for this project")
    return result


@router.delete("/{project_id}/lock")
async def release_lock(
    project_id: int,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Release the soft lock. Owner or admin can release."""
    if user["role"] == "admin":
        released = lock_service.force_release_lock(project_id)
    else:
        released = lock_service.release_lock(project_id, user["id"])

    if released:
        write_audit_log(
            user_id=user["id"],
            action="project.lock_released",
            resource_type="project",
            resource_id=project_id,
            ip_address=request.client.host if request.client else None,
        )
    return {"status": "released" if released else "no_lock"}


@router.get("/{project_id}/lock")
async def get_lock_status(
    project_id: int,
    user: dict = Depends(get_current_user),
):
    """Check current lock status for a project."""
    lock = lock_service.get_lock(project_id)
    if not lock:
        return {"locked": False}
    return {
        "locked": True,
        "holder": lock["username"],
        "holder_id": lock["user_id"],
        "acquired_at": lock["acquired_at"],
        "is_mine": lock["user_id"] == user["id"],
    }
