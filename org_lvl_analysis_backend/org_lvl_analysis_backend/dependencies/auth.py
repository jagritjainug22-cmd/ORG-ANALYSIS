"""
FastAPI dependencies for authentication and authorization.

Dependency variants:
- get_current_user: standard protected endpoints (blocks must_change_password users)
- get_current_user_allow_password_change: for /auth/change-password and /auth/logout
- require_admin: admin-only endpoints
- require_project_access: factory that returns a dependency checking project membership
"""

from datetime import datetime
from typing import Any, Dict

from fastapi import Depends, HTTPException, Request

from services import db_service
from services.token_service import decode_access_token
from services import project_service
from services.audit_service import write_audit_log


async def get_current_user(request: Request) -> Dict[str, Any]:
    """Extract and validate JWT from Authorization header.

    Enforces must_change_password server-side: users who haven't changed
    their initial password are blocked from all endpoints except
    /auth/change-password and /auth/logout.
    """
    user = _extract_user_from_token(request)
    if user["must_change_password"]:
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "password_change_required",
                "message": "You must change your password before accessing this resource.",
            },
        )
    return user


async def get_current_user_allow_password_change(request: Request) -> Dict[str, Any]:
    """Same as get_current_user but skips the must_change_password check.

    Used by /auth/change-password and /auth/logout so users aren't stuck
    in a dead-end after first login.
    """
    return _extract_user_from_token(request)


async def require_admin(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Ensures the current user is an admin."""
    if user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "admin_required",
                "message": "This action requires administrator privileges.",
            },
        )
    return user


def require_project_access(permission: str = "member"):
    """Factory returning a dependency that checks project access.

    Admins bypass assignment/deadline/status checks, but actions on
    expired or inactive projects are logged with admin_override: true.
    """
    async def dependency(
        project_id: int,
        request: Request,
        user: Dict[str, Any] = Depends(get_current_user),
    ) -> Dict[str, Any]:
        project = project_service.get_project(project_id)
        if not project:
            raise HTTPException(
                status_code=404,
                detail={"error_code": "project_not_found", "message": "Project not found."},
            )

        is_admin = user["role"] == "admin"
        is_expired = (
            project["deadline"]
            and datetime.fromisoformat(project["deadline"]) < datetime.utcnow()
        )
        is_inactive = project["status"] != "active"

        if is_admin:
            if is_expired or is_inactive:
                write_audit_log(
                    user_id=user["id"],
                    action="admin_override",
                    resource_type="project",
                    resource_id=project_id,
                    details={
                        "admin_override": True,
                        "reason": "deadline_expired" if is_expired else "project_inactive",
                    },
                    ip_address=request.client.host if request.client else None,
                )
            request.state.project = project
            return user

        assignment = project_service.get_assignment(project_id, user["id"])
        if not assignment:
            raise HTTPException(
                status_code=403,
                detail={
                    "error_code": "not_assigned",
                    "message": "You are not assigned to this project.",
                },
            )
        if is_expired:
            raise HTTPException(
                status_code=403,
                detail={
                    "error_code": "project_deadline_expired",
                    "message": "Project deadline has passed. Contact your admin for an extension.",
                },
            )
        if is_inactive:
            raise HTTPException(
                status_code=403,
                detail={
                    "error_code": "project_inactive",
                    "message": "This project is no longer active.",
                },
            )

        request.state.project = project
        return user

    return dependency


def _extract_user_from_token(request: Request) -> Dict[str, Any]:
    """Shared logic: extract Bearer token, decode JWT, load user from DB."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header.removeprefix("Bearer ")
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")

    user = db_service.get_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user["is_active"]:
        raise HTTPException(status_code=401, detail="Account is deactivated")

    return user
