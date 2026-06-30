"""
Admin router -- user management, project management, assignments, audit log,
and platform analytics dashboard.

All endpoints require admin role via the require_admin dependency.
Every mutating action is recorded in the audit log.
"""

import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel

from dependencies.auth import require_admin
from services import db_service, project_service, user_service
from services.audit_service import write_audit_log, query_audit_log

logger = logging.getLogger(__name__)

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


@router.post("/users/{user_id}/revoke-sessions")
async def revoke_user_sessions(
    user_id: int,
    request: Request,
    admin: dict = Depends(require_admin),
):
    """Revoke all active refresh tokens for a user without deactivating the account."""
    user = db_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, detail="User not found")

    if user_id == admin["id"]:
        raise HTTPException(400, detail="Cannot revoke your own sessions this way — use logout instead")

    db_service.revoke_all_user_tokens(user_id)

    write_audit_log(
        user_id=admin["id"],
        action="user.revoke_sessions",
        resource_type="user",
        resource_id=user_id,
        details={"username": user["username"]},
        ip_address=request.client.host if request.client else None,
    )

    return {"status": "sessions_revoked", "user_id": user_id, "username": user["username"]}


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

    try:
        from services.email_service import notify_user_assigned_to_project
        notify_user_assigned_to_project(username=user["username"], project_name=project["name"], role=body.role)
    except Exception as email_err:
        import logging
        logging.getLogger(__name__).warning("Failed to trigger assignment email: %s", email_err)

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


# ---------------------------------------------------------------------------
# Analytics dashboard
# ---------------------------------------------------------------------------

def _initials(display_name: Optional[str], username: str) -> str:
    """Derive 2-letter initials from display_name or username."""
    if display_name and " " in display_name.strip():
        parts = display_name.strip().split()
        return (parts[0][0] + parts[-1][0]).upper()
    return username[:2].upper()


def _categorize_action(action: str) -> str:
    """Map audit_log action strings into dashboard categories."""
    a = action.lower()
    if "upload" in a or a.startswith("dataset."):
        return "Data Upload"
    if "scenario" in a or "change_log" in a or "move" in a or "edit" in a:
        return "Scenario Edits"
    if "export" in a or "ppt" in a or "excel" in a or "download" in a:
        return "Exports"
    return "Other"


_analytics_cache: dict = {}
_ANALYTICS_TTL = 120


def _bucket_key(ts_str: str, hourly: bool) -> str:
    """Extract YYYY-MM-DD or HH from an ISO timestamp string."""
    if not ts_str:
        return ""
    return ts_str[11:13] if hourly else ts_str[:10]


def _group_by_bucket(rows, ts_field: str, cutoff: str, hourly: bool) -> dict:
    """Group in-memory rows by date/hour bucket, counting rows >= cutoff."""
    counts: dict = defaultdict(int)
    for r in rows:
        ts = r[ts_field] or ""
        if ts >= cutoff:
            key = _bucket_key(ts, hourly)
            if key:
                counts[key] += 1
    return dict(counts)


def _build_analytics(time_range: str) -> dict:
    """Pure computation — runs SQL, builds the analytics payload."""
    now = datetime.utcnow()
    now_iso = now.isoformat()
    five_min_ago = (now - timedelta(minutes=5)).isoformat()
    three_days_from_now = (now + timedelta(days=3)).isoformat()

    range_days = {"1d": 1, "7d": 7, "30d": 30}[time_range]
    range_ago = (now - timedelta(days=range_days)).isoformat()
    prev_range_ago = (now - timedelta(days=range_days * 2)).isoformat()
    seven_days_ago = (now - timedelta(days=7)).isoformat()
    is_hourly = time_range == "1d"

    with db_service._connect_ro() as conn:
        # ---------------------------------------------------------------
        # 5 base queries — fetch full tables ONCE, reuse everywhere
        # ---------------------------------------------------------------
        all_users = conn.execute(
            "SELECT id, username, display_name, is_active, created_at FROM users"
        ).fetchall()
        all_tokens = conn.execute(
            "SELECT id, user_id, created_at, revoked_at, expires_at, last_seen_at FROM refresh_tokens"
        ).fetchall()
        all_projects = conn.execute(
            "SELECT id, name, status, created_at, deadline FROM projects"
        ).fetchall()
        all_datasets = conn.execute(
            "SELECT id, name, username, upload_time, project_id FROM datasets"
        ).fetchall()
        all_scenarios = conn.execute(
            "SELECT id, dataset_id, name, is_promoted, updated_at FROM scenarios"
        ).fetchall()

        # ---------------------------------------------------------------
        # KPIs — all computed in Python from loaded rows
        # ---------------------------------------------------------------
        total_users = len(all_users)
        active_users = sum(1 for u in all_users if u["is_active"] == 1)
        active_sessions = len({
            t["user_id"] for t in all_tokens
            if t["revoked_at"] is None
            and (t.get("last_seen_at") or "") >= five_min_ago
        })
        total_projects = len(all_projects)
        active_projects = sum(1 for p in all_projects if p["status"] == "active")
        total_datasets = len(all_datasets)
        total_scenarios = len(all_scenarios)

        projects_near_deadline = sum(
            1 for p in all_projects
            if p["status"] == "active"
            and p.get("deadline")
            and p["deadline"] <= three_days_from_now
            and p["deadline"] >= now_iso[:10]
        )

        # Deltas
        users_current = sum(1 for u in all_users if (u["created_at"] or "") >= range_ago)
        users_prev = sum(1 for u in all_users if range_ago > (u["created_at"] or "") >= prev_range_ago)
        datasets_current = sum(1 for d in all_datasets if (d["upload_time"] or "") >= range_ago)
        datasets_prev = sum(1 for d in all_datasets if range_ago > (d["upload_time"] or "") >= prev_range_ago)
        sessions_current = sum(1 for t in all_tokens if (t["created_at"] or "") >= range_ago)
        sessions_prev = sum(1 for t in all_tokens if range_ago > (t["created_at"] or "") >= prev_range_ago)

        # ---------------------------------------------------------------
        # Sparklines — computed in Python (eliminates 3 SQL queries)
        # ---------------------------------------------------------------
        spark_dates = [(now - timedelta(days=6 - i)).strftime("%Y-%m-%d") for i in list(range(7))]

        users_by_day = _group_by_bucket(all_users, "created_at", seven_days_ago, False)
        users_sparkline = [users_by_day.get(d, 0) for d in spark_dates]
        tokens_by_day = _group_by_bucket(all_tokens, "created_at", seven_days_ago, False)
        sessions_sparkline = [tokens_by_day.get(d, 0) for d in spark_dates]
        datasets_by_day_s = _group_by_bucket(all_datasets, "upload_time", seven_days_ago, False)
        datasets_sparkline = [datasets_by_day_s.get(d, 0) for d in spark_dates]
        projects_sparkline = [active_projects] * 7

        # ---------------------------------------------------------------
        # Daily activity trend — logins/uploads computed in Python
        # (eliminates 2 SQL queries), edits/admin still need SQL since
        # change_log and audit_log are NOT fully fetched
        # ---------------------------------------------------------------
        if is_hourly:
            buckets = [f"{h:02d}" for h in list(range(24))]
        else:
            buckets = [(now - timedelta(days=range_days - 1 - i)).strftime("%Y-%m-%d")
                        for i in list(range(range_days))]

        logins_by_b = _group_by_bucket(all_tokens, "created_at", range_ago, is_hourly)
        uploads_by_b = _group_by_bucket(all_datasets, "upload_time", range_ago, is_hourly)

        b_col_ts = f"SUBSTRING(timestamp, 12, 2)" if is_hourly else f"SUBSTRING(timestamp, 1, 10)"
        b_col_al = f"SUBSTRING(created_at, 12, 2)" if is_hourly else f"SUBSTRING(created_at, 1, 10)"

        edits_by_b = {r["d"]: r["n"] for r in conn.execute(
            f"SELECT {b_col_ts} AS d, COUNT(*) AS n FROM change_log WHERE timestamp >= ? GROUP BY d",
            (range_ago,),
        ).fetchall()}
        admin_by_b = {r["d"]: r["n"] for r in conn.execute(
            f"SELECT {b_col_al} AS d, COUNT(*) AS n FROM audit_log WHERE created_at >= ? GROUP BY d",
            (range_ago,),
        ).fetchall()}

        daily_activity_trend = []
        for b in buckets:
            lo = logins_by_b.get(b, 0)
            up = uploads_by_b.get(b, 0)
            ed = edits_by_b.get(b, 0)
            ad = admin_by_b.get(b, 0)
            daily_activity_trend.append({
                "date": b,
                "logins": lo, "uploads": up, "scenario_edits": ed,
                "admin_actions": ad, "total_actions": lo + up + ed + ad,
            })

        # ---------------------------------------------------------------
        # Activity distribution — logins/uploads from Python, edits/admin
        # are just the sums of the trend dicts (eliminates 2 SQL queries)
        # ---------------------------------------------------------------
        dist_logins = sum(1 for t in all_tokens if (t["created_at"] or "") >= range_ago)
        dist_uploads = sum(1 for d in all_datasets if (d["upload_time"] or "") >= range_ago)
        dist_edits = sum(edits_by_b.values())
        dist_admin = sum(admin_by_b.values())

        dist_total = dist_logins + dist_uploads + dist_edits + dist_admin or 1
        activity_distribution = []
        for cat, cnt in [("Logins", dist_logins), ("Data Uploads", dist_uploads),
                         ("Scenario Edits", dist_edits), ("Admin Actions", dist_admin)]:
            if cnt > 0:
                activity_distribution.append({
                    "category": cat, "count": cnt,
                    "percentage": round(cnt / dist_total * 100),
                })
        if not activity_distribution:
            activity_distribution = [{"category": "No activity", "count": 0, "percentage": 0}]

        # ---------------------------------------------------------------
        # Activity detail — per-category drill-down
        # ---------------------------------------------------------------
        admin_detail_rows = conn.execute(
            "SELECT action, COUNT(*) AS n FROM audit_log WHERE created_at >= ? GROUP BY action ORDER BY n DESC",
            (range_ago,),
        ).fetchall()
        login_detail: dict = {}
        for t in all_tokens:
            if (t["created_at"] or "") >= range_ago:
                login_detail[t["user_id"]] = login_detail.get(t["user_id"], 0) + 1
        user_map = {u["id"]: u["username"] for u in all_users}
        login_detail_list = [{"username": user_map.get(uid, "unknown"), "count": c}
                             for uid, c in sorted(login_detail.items(), key=lambda x: -x[1])[:10]]

        activity_detail = {
            "Admin Actions": [{"action": r["action"], "count": r["n"]} for r in admin_detail_rows],
            "Logins": login_detail_list,
            "Data Uploads": [{"dataset": d["name"], "user": d["username"], "time": d["upload_time"]}
                             for d in all_datasets if (d["upload_time"] or "") >= range_ago][:15],
            "Scenario Edits": dist_edits,
        }

        # ---------------------------------------------------------------
        # Recent activity feed (last 15 audit entries — needs SQL for JOIN)
        # ---------------------------------------------------------------
        feed_rows = conn.execute(
            "SELECT al.id, al.action, al.resource_type, al.resource_id, "
            "al.details_json, al.created_at, u.username, u.display_name "
            "FROM audit_log al LEFT JOIN users u ON al.user_id = u.id "
            "ORDER BY al.created_at DESC LIMIT 15"
        ).fetchall()

        recent_activity = []
        for r in feed_rows:
            details_str = ""
            if r["details_json"]:
                try:
                    det = json.loads(r["details_json"])
                    details_str = det.get("name", det.get("username", ""))
                except Exception:
                    pass
            recent_activity.append({
                "id": r["id"],
                "username": r["username"] or "system",
                "action": r["action"],
                "resource_type": r["resource_type"],
                "details": details_str,
                "created_at": r["created_at"],
            })

        # ---------------------------------------------------------------
        # Top contributors — uploads computed in Python from all_datasets
        # edits/admin still need 2 JOINed SQL queries for display_name
        # ---------------------------------------------------------------
        contrib_scores: dict = {}
        dname_map = {u["username"]: u["display_name"] for u in all_users}

        def _ca(uname, dname, uploads=0, edits=0, admin=0):
            if uname not in contrib_scores:
                contrib_scores[uname] = {"username": uname, "display_name": dname,
                                         "score": 0, "uploads": 0, "edits": 0, "admin": 0}
            contrib_scores[uname]["uploads"] += uploads
            contrib_scores[uname]["edits"] += edits
            contrib_scores[uname]["admin"] += admin
            contrib_scores[uname]["score"] += uploads * 5 + edits + admin

        upload_counts: dict = defaultdict(int)
        for d in all_datasets:
            if (d["upload_time"] or "") >= range_ago and d["username"]:
                upload_counts[d["username"]] += 1
        for uname, cnt in upload_counts.items():
            _ca(uname, dname_map.get(uname), uploads=cnt)

        for r in conn.execute(
            "SELECT cl.username, u.display_name, COUNT(*) AS n "
            "FROM change_log cl LEFT JOIN users u ON cl.username = u.username "
            "WHERE cl.timestamp >= ? AND cl.username IS NOT NULL "
            "GROUP BY cl.username, u.display_name",
            (range_ago,),
        ).fetchall():
            _ca(r["username"], r["display_name"], edits=r["n"])

        for r in conn.execute(
            "SELECT u.username, u.display_name, COUNT(*) AS n "
            "FROM audit_log al JOIN users u ON al.user_id = u.id "
            "WHERE al.created_at >= ? GROUP BY u.username, u.display_name",
            (range_ago,),
        ).fetchall():
            _ca(r["username"], r["display_name"], admin=r["n"])

        top_contributors = [
            {"username": v["username"], "display_name": v["display_name"],
             "action_count": v["score"], "uploads": v["uploads"],
             "edits": v["edits"], "admin_actions": v["admin"],
             "initials": _initials(v["display_name"], v["username"])}
            for v in sorted(contrib_scores.values(), key=lambda x: -x["score"])[:10]
        ]

        # ---------------------------------------------------------------
        # Active sessions by user — computed in Python from all_tokens
        # (eliminates 1 SQL query)
        # ---------------------------------------------------------------
        sess_by_user: dict = defaultdict(lambda: {"count": 0, "last": ""})
        for t in all_tokens:
            if (
                t["revoked_at"] is None
                and (t.get("last_seen_at") or "") >= five_min_ago
            ):
                uid = t["user_id"]
                sess_by_user[uid]["count"] += 1
                ts = t.get("last_seen_at") or t["created_at"] or ""
                if ts > sess_by_user[uid]["last"]:
                    sess_by_user[uid]["last"] = ts

        user_by_id = {u["id"]: u for u in all_users}
        active_sessions_by_user = []
        for uid, info in sorted(sess_by_user.items(), key=lambda x: x[1]["last"], reverse=True):
            u = user_by_id.get(uid, {})
            active_sessions_by_user.append({
                "user_id": uid,
                "username": u.get("username", "unknown"),
                "display_name": u.get("display_name"),
                "session_count": info["count"],
                "last_active": info["last"],
                "initials": _initials(u.get("display_name"), u.get("username", "?")),
            })

        # ---------------------------------------------------------------
        # Active locks — project + dataset (2 small queries, cannot avoid)
        # ---------------------------------------------------------------
        proj_locks = conn.execute(
            "SELECT pl.project_id, p.name AS project_name, pl.username, pl.acquired_at "
            "FROM project_locks pl JOIN projects p ON p.id = pl.project_id"
        ).fetchall()
        ds_locks = conn.execute(
            "SELECT dl.dataset_id, d.name AS dataset_name, dl.username, "
            "dl.project_id, p.name AS project_name, dl.acquired_at "
            "FROM dataset_locks dl JOIN datasets d ON d.id = dl.dataset_id "
            "LEFT JOIN projects p ON dl.project_id = p.id"
        ).fetchall()
        active_locks = {
            "project_locks": [{"project_id": r["project_id"], "project_name": r["project_name"],
                               "username": r["username"], "acquired_at": r["acquired_at"]}
                              for r in proj_locks],
            "dataset_locks": [{"dataset_id": r["dataset_id"], "dataset_name": r["dataset_name"],
                               "username": r["username"], "project_name": r["project_name"] or "—",
                               "acquired_at": r["acquired_at"]}
                              for r in ds_locks],
        }

        # ---------------------------------------------------------------
        # Scenarios overview — pure Python from already-loaded rows
        # ---------------------------------------------------------------
        ds_map = {d["id"]: d for d in all_datasets}
        proj_map = {p["id"]: p["name"] for p in all_projects}
        scenarios_overview = []
        for s in sorted(all_scenarios, key=lambda x: x["updated_at"] or "", reverse=True)[:50]:
            ds = ds_map.get(s["dataset_id"], {})
            scenarios_overview.append({
                "id": s["id"], "name": s["name"],
                "is_promoted": s["is_promoted"],
                "updated_at": s["updated_at"],
                "dataset_name": ds.get("name", "—"),
                "project_name": proj_map.get(ds.get("project_id"), "—"),
            })

        # ---------------------------------------------------------------
        # User status list — pure Python
        # ---------------------------------------------------------------
        last_login_map: dict = {}
        for t in all_tokens:
            uid = t["user_id"]
            ts = t["created_at"] or ""
            if ts > last_login_map.get(uid, ""):
                last_login_map[uid] = ts

        user_status_list = [{
            "id": u["id"], "username": u["username"],
            "display_name": u["display_name"],
            "is_active": u["is_active"],
            "last_login": last_login_map.get(u["id"]),
            "initials": _initials(u["display_name"], u["username"]),
        } for u in all_users]

        # ---------------------------------------------------------------
        # Datasets overview (needs JOIN for scenario/view counts)
        # ---------------------------------------------------------------
        ds_rows = conn.execute(
            "SELECT d.id, d.name, d.username, d.upload_time, d.row_count, d.project_id, "
            "p.name AS project_name, "
            "COALESCE(sc.scenario_count, 0) AS scenario_count, "
            "COALESCE(vc.view_count, 0) AS view_count "
            "FROM datasets d "
            "LEFT JOIN projects p ON d.project_id = p.id "
            "LEFT JOIN (SELECT dataset_id, COUNT(*) AS scenario_count FROM scenarios GROUP BY dataset_id) sc ON sc.dataset_id = d.id "
            "LEFT JOIN (SELECT dataset_id, COUNT(*) AS view_count FROM dataset_user_views GROUP BY dataset_id) vc ON vc.dataset_id = d.id "
            "ORDER BY d.upload_time DESC"
        ).fetchall()

        max_views = max((r["view_count"] for r in ds_rows), default=1) or 1
        datasets_overview = [{
            "id": r["id"], "name": r["name"],
            "project_name": r["project_name"] or "—",
            "uploaded_by": r["username"],
            "uploader_initials": _initials(None, r["username"]),
            "upload_time": r["upload_time"],
            "row_count": r["row_count"],
            "scenario_count": r["scenario_count"],
            "view_count": r["view_count"],
            "engagement_pct": round(r["view_count"] / max_views * 100),
        } for r in ds_rows]

    avg_ds = round(total_datasets / total_projects, 1) if total_projects else 0

    return {
        "generated_at": now_iso,
        "range": time_range,
        "cached": False,
        "kpis": {
            "total_users": total_users, "active_users": active_users,
            "active_sessions": active_sessions,
            "total_projects": total_projects, "active_projects": active_projects,
            "total_datasets": total_datasets, "total_scenarios": total_scenarios,
            "projects_near_deadline": projects_near_deadline,
            "users_delta": users_current - users_prev,
            "sessions_delta": sessions_current - sessions_prev,
            "datasets_delta": datasets_current - datasets_prev,
            "users_sparkline": users_sparkline,
            "sessions_sparkline": sessions_sparkline,
            "projects_sparkline": projects_sparkline,
            "datasets_sparkline": datasets_sparkline,
        },
        "quick_stats": {
            "total_scenarios": total_scenarios,
            "active_user_pct": round(active_users / total_users * 100) if total_users else 0,
            "avg_datasets_per_project": avg_ds,
            "inactive_users": total_users - active_users,
            "edits_in_range": dist_edits,
        },
        "daily_activity_trend": daily_activity_trend,
        "activity_distribution": activity_distribution,
        "activity_detail": activity_detail,
        "recent_activity": recent_activity,
        "top_contributors": top_contributors,
        "active_sessions_by_user": active_sessions_by_user,
        "active_locks": active_locks,
        "scenarios_overview": scenarios_overview,
        "user_status_list": user_status_list,
        "datasets_overview": datasets_overview,
    }


@router.get("/analytics")
async def get_analytics(
    admin: dict = Depends(require_admin),
    time_range: str = Query("7d", alias="range", pattern="^(1d|7d|30d)$"),
    force: bool = Query(False),
):
    """Aggregated analytics with a 2-minute server-side cache."""
    if not force:
        cached = _analytics_cache.get(time_range)
        if cached and (time.time() - cached[0]) < _ANALYTICS_TTL:
            result = cached[1].copy()
            result["cached"] = True
            return result

    result = _build_analytics(time_range)
    _analytics_cache[time_range] = (time.time(), result)
    return result
