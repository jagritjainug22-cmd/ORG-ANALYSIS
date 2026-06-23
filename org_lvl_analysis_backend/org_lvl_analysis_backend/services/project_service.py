"""
Project service -- CRUD for projects and project assignments.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from services.db_service import _connect, _connect_ro


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

def create_project(
    name: str,
    created_by: int,
    description: Optional[str] = None,
    deadline: Optional[str] = None,
) -> Dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO projects (name, description, deadline, status, created_by, created_at, updated_at)
            VALUES (?, ?, ?, 'active', ?, ?, ?)
            """,
            (name, description, deadline, created_by, now, now),
        )
        conn.commit()
        return get_project(c.lastrowid)


def get_project(project_id: int) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return dict(row) if row else None


def list_all_projects() -> List[Dict[str, Any]]:
    with _connect_ro() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


def list_user_projects(user_id: int) -> List[Dict[str, Any]]:
    with _connect_ro() as conn:
        rows = conn.execute(
            """
            SELECT p.*, pa.role AS assignment_role, pa.assigned_at
            FROM projects p
            JOIN project_assignments pa ON p.id = pa.project_id
            WHERE pa.user_id = ? AND p.status = 'active'
            ORDER BY p.updated_at DESC
            """,
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def list_projects_with_metadata(user_id: int, is_admin: bool = False) -> List[Dict[str, Any]]:
    """Fetch the list of projects (either all projects for admins, or assigned projects for a user)
    including locks, dataset count, member count, and first 5 active members preview in just 2 queries.
    """
    if is_admin:
        project_query = """
            SELECT 
              p.*,
              pl.username as locked_by,
              pl.user_id as locked_by_id,
              COALESCE(ds.dataset_count, 0) as dataset_count,
              COALESCE(mem.member_count, 0) as member_count
            FROM projects p
            LEFT JOIN project_locks pl ON p.id = pl.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as dataset_count FROM datasets GROUP BY project_id
            ) ds ON p.id = ds.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as member_count FROM project_assignments GROUP BY project_id
            ) mem ON p.id = mem.project_id
            ORDER BY p.created_at DESC
        """
        params = ()
    else:
        project_query = """
            SELECT 
              p.*,
              pa.role AS assignment_role, pa.assigned_at,
              pl.username as locked_by,
              pl.user_id as locked_by_id,
              COALESCE(ds.dataset_count, 0) as dataset_count,
              COALESCE(mem.member_count, 0) as member_count
            FROM projects p
            JOIN project_assignments pa ON p.id = pa.project_id
            LEFT JOIN project_locks pl ON p.id = pl.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as dataset_count FROM datasets GROUP BY project_id
            ) ds ON p.id = ds.project_id
            LEFT JOIN (
              SELECT project_id, COUNT(*) as member_count FROM project_assignments GROUP BY project_id
            ) mem ON p.id = mem.project_id
            WHERE pa.user_id = ? AND p.status = 'active'
            ORDER BY p.updated_at DESC
        """
        params = (user_id,)

    with _connect_ro() as conn:
        projects = [dict(r) for r in conn.execute(project_query, params).fetchall()]
        if not projects:
            return []

        project_ids = [p["id"] for p in projects]
        placeholders = ", ".join("?" for _ in project_ids)
        
        # Query 2: Fetch only the first 5 active members for previews in a single batch
        preview_query = f"""
            WITH RankedMembers AS (
                SELECT 
                  pa.project_id, pa.role, pa.assigned_at,
                  u.id AS user_id, u.username, u.display_name, u.is_active,
                  ROW_NUMBER() OVER(PARTITION BY pa.project_id ORDER BY pa.assigned_at) as rn
                FROM project_assignments pa
                JOIN users u ON pa.user_id = u.id
                WHERE pa.project_id IN ({placeholders}) AND u.is_active = 1
            )
            SELECT * FROM RankedMembers WHERE rn <= 5
        """
        previews = [dict(r) for r in conn.execute(preview_query, project_ids).fetchall()]

    # Group previews by project_id
    previews_by_project = {}
    for m in previews:
        pid = m["project_id"]
        previews_by_project.setdefault(pid, []).append({
            "user_id": m["user_id"],
            "username": m["username"],
            "display_name": m["display_name"],
            "role": m["role"],
        })

    # Merge projects and previews
    for p in projects:
        p["members_preview"] = previews_by_project.get(p["id"], [])
        
    return projects


def update_project(
    project_id: int,
    name: Optional[str] = None,
    description: Optional[str] = None,
    deadline: Optional[str] = None,
    status: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    now = datetime.utcnow().isoformat()
    updates = []
    params = []

    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if deadline is not None:
        updates.append("deadline = ?")
        params.append(deadline if deadline != "" else None)
    if status is not None:
        updates.append("status = ?")
        params.append(status)

    if not updates:
        return get_project(project_id)

    updates.append("updated_at = ?")
    params.append(now)
    params.append(project_id)

    with _connect() as conn:
        conn.execute(
            f"UPDATE projects SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()
    return get_project(project_id)


def delete_project(project_id: int) -> bool:
    """Soft-delete: set status to 'archived'."""
    return update_project(project_id, status="archived") is not None


def hard_delete_project(project_id: int) -> bool:
    """Permanently delete a project and all related data (assignments, datasets, scenarios, change_log)."""
    with _connect() as conn:
        conn.execute("DELETE FROM project_assignments WHERE project_id = ?", (project_id,))
        dataset_ids = [r["id"] for r in conn.execute("SELECT id FROM datasets WHERE project_id = ?", (project_id,)).fetchall()]
        for did in dataset_ids:
            conn.execute("DELETE FROM change_log WHERE scenario_id IN (SELECT id FROM scenarios WHERE dataset_id = ?)", (did,))
            conn.execute("DELETE FROM scenarios WHERE dataset_id = ?", (did,))
        conn.execute("DELETE FROM datasets WHERE project_id = ?", (project_id,))
        result = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return result.rowcount > 0


def cleanup_stale_archived(days: int = 30) -> List[int]:
    """Hard-delete projects archived more than `days` ago. Returns list of deleted project IDs."""
    from datetime import timedelta
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id FROM projects WHERE status = 'archived' AND updated_at <= ?", (cutoff,)
        ).fetchall()
    deleted = []
    for row in rows:
        if hard_delete_project(row["id"]):
            deleted.append(row["id"])
    return deleted


# ---------------------------------------------------------------------------
# Project assignments
# ---------------------------------------------------------------------------

def get_assignment(project_id: int, user_id: int) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM project_assignments WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        ).fetchone()
        return dict(row) if row else None


def get_projects_overview(project_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    """For each project_id, return a lightweight overview:
        - member_count
        - members_preview (first 5 active members, ordered by assignment)
        - dataset_count

    Used by the projects listing page to render stacked avatars and stats
    without an N+1 fetch per row.
    """
    if not project_ids:
        return {}

    placeholders = ",".join("?" for _ in project_ids)
    overview: Dict[int, Dict[str, Any]] = {pid: {
        "member_count": 0,
        "members_preview": [],
        "dataset_count": 0,
    } for pid in project_ids}

    with _connect_ro() as conn:
        member_rows = conn.execute(
            f"""
            SELECT pa.project_id, pa.role, pa.assigned_at,
                   u.id AS user_id, u.username, u.display_name, u.is_active
            FROM project_assignments pa
            JOIN users u ON pa.user_id = u.id
            WHERE pa.project_id IN ({placeholders})
            ORDER BY pa.project_id, pa.assigned_at
            """,
            project_ids,
        ).fetchall()

        for row in member_rows:
            pid = row["project_id"]
            entry = overview[pid]
            entry["member_count"] += 1
            if len(entry["members_preview"]) < 5 and row["is_active"]:
                entry["members_preview"].append({
                    "user_id": row["user_id"],
                    "username": row["username"],
                    "display_name": row["display_name"],
                    "role": row["role"],
                })

        ds_rows = conn.execute(
            f"""
            SELECT project_id, COUNT(*) AS n
            FROM datasets
            WHERE project_id IN ({placeholders})
            GROUP BY project_id
            """,
            project_ids,
        ).fetchall()
        for row in ds_rows:
            overview[row["project_id"]]["dataset_count"] = row["n"]

    return overview


def list_project_assignments(project_id: int) -> List[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT pa.*, u.username, u.display_name, u.role AS user_role, u.is_active
            FROM project_assignments pa
            JOIN users u ON pa.user_id = u.id
            WHERE pa.project_id = ?
            ORDER BY pa.assigned_at
            """,
            (project_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def assign_user(
    project_id: int,
    user_id: int,
    assigned_by: int,
    role: str = "member",
) -> Dict[str, Any]:
    now = datetime.utcnow().isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO project_assignments (project_id, user_id, role, assigned_at, assigned_by)
            VALUES (?, ?, ?, ?, ?)
            """,
            (project_id, user_id, role, now, assigned_by),
        )
        conn.commit()
    return get_assignment(project_id, user_id)


def remove_assignment(project_id: int, user_id: int) -> bool:
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM project_assignments WHERE project_id = ? AND user_id = ?",
            (project_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
