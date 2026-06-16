"""
Admin router -- user management, project management, assignments, audit log.

All endpoints require admin role via the require_admin dependency.
Every mutating action is recorded in the audit log.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel

from dependencies.auth import require_admin
from services import db_service, project_service, user_service
from services.audit_service import write_audit_log, query_audit_log

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    role: str = "member"


class UpdateUserRequest(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    reset_password: Optional[str] = None


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None
    deadline: Optional[str] = None


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    deadline: Optional[str] = None
    status: Optional[str] = None


class AssignUserRequest(BaseModel):
    user_id: int
    role: str = "member"


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_users(admin: dict = Depends(require_admin)):
    with db_service._connect_ro() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, role, is_active, must_change_password, created_at, updated_at FROM users ORDER BY id"
        ).fetchall()

        # Pull all assignments + project names in one go and group by user_id
        # to avoid an N+1. Only surface active projects.
        assignments = conn.execute(
            """
            SELECT pa.user_id, pa.role AS project_role,
                   p.id AS project_id, p.name AS project_name, p.status AS project_status
            FROM project_assignments pa
            JOIN projects p ON p.id = pa.project_id
            ORDER BY LOWER(p.name)
            """
        ).fetchall()

    projects_by_user: dict[int, list[dict]] = {}
    for row in assignments:
        projects_by_user.setdefault(row["user_id"], []).append({
            "id": row["project_id"],
            "name": row["project_name"],
            "status": row["project_status"],
            "role": row["project_role"],
        })

    users = []
    for r in rows:
        u = dict(r)
        u["projects"] = projects_by_user.get(u["id"], [])
        u["project_count"] = len(u["projects"])
        users.append(u)
    return users


@router.post("/users", status_code=201)
async def create_user(
    body: CreateUserRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    if body.role not in ("admin", "member"):
        raise HTTPException(400, detail="Role must be 'admin' or 'member'")
    if len(body.password) < 8:
        raise HTTPException(400, detail="Password must be at least 8 characters")

    existing = db_service.get_user_by_username(body.username)
    if existing:
        raise HTTPException(409, detail="Username already exists")

    password_hash = user_service.hash_password(body.password)
    user_id = db_service.create_user(
        username=body.username,
        password_hash=password_hash,
        display_name=body.display_name,
        role=body.role,
    )

    write_audit_log(
        user_id=admin["id"],
        action="user.create",
        resource_type="user",
        resource_id=user_id,
        details={"username": body.username, "role": body.role},
        ip_address=request.client.host if request.client else None,
    )

    return db_service.get_user_by_id(user_id)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UpdateUserRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    user = db_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, detail="User not found")

    changes = {}
    now_str = __import__("datetime").datetime.utcnow().isoformat()

    with db_service._connect() as conn:
        if body.display_name is not None:
            conn.execute(
                "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
                (body.display_name, now_str, user_id),
            )
            changes["display_name"] = body.display_name

        if body.role is not None:
            if body.role not in ("admin", "member"):
                raise HTTPException(400, detail="Role must be 'admin' or 'member'")
            conn.execute(
                "UPDATE users SET role = ?, updated_at = ? WHERE id = ?",
                (body.role, now_str, user_id),
            )
            changes["role"] = body.role

        if body.is_active is not None:
            conn.execute(
                "UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?",
                (1 if body.is_active else 0, now_str, user_id),
            )
            changes["is_active"] = body.is_active

        if body.reset_password is not None:
            if len(body.reset_password) < 8:
                raise HTTPException(400, detail="Password must be at least 8 characters")
            new_hash = user_service.hash_password(body.reset_password)
            conn.execute(
                "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?",
                (new_hash, now_str, user_id),
            )
            changes["password_reset"] = True

        conn.commit()

    if changes:
        write_audit_log(
            user_id=admin["id"],
            action="user.update",
            resource_type="user",
            resource_id=user_id,
            details=changes,
            ip_address=request.client.host if request.client else None,
        )

    return db_service.get_user_by_id(user_id)


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: int,
    request: Request,
    admin: dict = Depends(require_admin),
):
    user = db_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, detail="User not found")

    if user_id == admin["id"]:
        raise HTTPException(400, detail="Cannot deactivate yourself")

    with db_service._connect() as conn:
        conn.execute(
            "UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?",
            (__import__("datetime").datetime.utcnow().isoformat(), user_id),
        )
        conn.commit()

    db_service.revoke_all_user_tokens(user_id)

    write_audit_log(
        user_id=admin["id"],
        action="user.deactivate",
        resource_type="user",
        resource_id=user_id,
        details={"username": user["username"]},
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "deactivated", "user_id": user_id}


# ---------------------------------------------------------------------------
# Project management
# ---------------------------------------------------------------------------

@router.get("/projects")
async def list_projects(admin: dict = Depends(require_admin)):
    project_service.cleanup_stale_archived(days=30)
    return project_service.list_all_projects()


@router.post("/projects", status_code=201)
async def create_project(
    body: CreateProjectRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    project = project_service.create_project(
        name=body.name,
        created_by=admin["id"],
        description=body.description,
        deadline=body.deadline,
    )

    write_audit_log(
        user_id=admin["id"],
        action="project.create",
        resource_type="project",
        resource_id=project["id"],
        details={"name": body.name, "deadline": body.deadline},
        ip_address=request.client.host if request.client else None,
    )

    return project


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: int,
    body: UpdateProjectRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    if body.status and body.status not in ("active", "archived", "closed"):
        raise HTTPException(400, detail="Status must be 'active', 'archived', or 'closed'")

    updated = project_service.update_project(
        project_id,
        name=body.name,
        description=body.description,
        deadline=body.deadline,
        status=body.status,
    )

    changes = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if changes:
        write_audit_log(
            user_id=admin["id"],
            action="project.update",
            resource_type="project",
            resource_id=project_id,
            details=changes,
            ip_address=request.client.host if request.client else None,
        )

    return updated


@router.delete("/projects/{project_id}")
async def archive_project(
    project_id: int,
    request: Request,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    project_service.delete_project(project_id)

    write_audit_log(
        user_id=admin["id"],
        action="project.archive",
        resource_type="project",
        resource_id=project_id,
        details={"name": project["name"]},
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "archived", "project_id": project_id}


@router.post("/projects/{project_id}/delete")
async def permanently_delete_project(
    project_id: int,
    request: Request,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    project_service.hard_delete_project(project_id)

    write_audit_log(
        user_id=admin["id"],
        action="project.hard_delete",
        resource_type="project",
        resource_id=project_id,
        details={"name": project["name"], "status_at_delete": project["status"]},
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "deleted", "project_id": project_id}


# ---------------------------------------------------------------------------
# Project assignments
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/assignments")
async def list_assignments(
    project_id: int,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")
    return project_service.list_project_assignments(project_id)


@router.post("/projects/{project_id}/assignments", status_code=201)
async def assign_user_to_project(
    project_id: int,
    body: AssignUserRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    user = db_service.get_user_by_id(body.user_id)
    if not user:
        raise HTTPException(404, detail="User not found")

    existing = project_service.get_assignment(project_id, body.user_id)
    if existing:
        raise HTTPException(409, detail="User is already assigned to this project")

    assignment = project_service.assign_user(
        project_id=project_id,
        user_id=body.user_id,
        assigned_by=admin["id"],
        role=body.role,
    )

    write_audit_log(
        user_id=admin["id"],
        action="project.assign",
        resource_type="project",
        resource_id=project_id,
        details={"assigned_user_id": body.user_id, "username": user["username"], "role": body.role},
        ip_address=request.client.host if request.client else None,
    )

    return assignment


@router.delete("/projects/{project_id}/assignments/{target_user_id}")
async def remove_user_from_project(
    project_id: int,
    target_user_id: int,
    request: Request,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    removed = project_service.remove_assignment(project_id, target_user_id)
    if not removed:
        raise HTTPException(404, detail="Assignment not found")

    user = db_service.get_user_by_id(target_user_id)
    write_audit_log(
        user_id=admin["id"],
        action="project.unassign",
        resource_type="project",
        resource_id=project_id,
        details={"removed_user_id": target_user_id, "username": user["username"] if user else None},
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "removed", "project_id": project_id, "user_id": target_user_id}


# ---------------------------------------------------------------------------
# Dataset management (admin view per-project)
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/datasets")
async def admin_list_project_datasets(
    project_id: int,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")
    datasets = db_service.list_datasets(project_id=project_id)
    return {"datasets": datasets}


@router.delete("/projects/{project_id}/datasets/{dataset_id}")
async def admin_delete_project_dataset(
    project_id: int,
    dataset_id: int,
    request: Request,
    admin: dict = Depends(require_admin),
):
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(404, detail="Project not found")

    dataset = db_service.get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, detail="Dataset not found")
    if dataset.get("project_id") != project_id:
        raise HTTPException(404, detail="Dataset does not belong to this project")

    db_service.delete_dataset(dataset_id)

    write_audit_log(
        user_id=admin["id"],
        action="dataset.delete",
        resource_type="dataset",
        resource_id=dataset_id,
        details={"name": dataset.get("name"), "project_id": project_id},
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "deleted", "dataset_id": dataset_id}


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@router.get("/audit-log")
async def get_audit_log(
    user_id: Optional[int] = Query(None),
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    admin: dict = Depends(require_admin),
):
    return query_audit_log(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
