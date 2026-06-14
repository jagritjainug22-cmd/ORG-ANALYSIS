"""
Audit log service -- structured logging of admin actions, state changes, and auth events.

Every entry includes the acting user, action type, affected resource, and
optional details JSON. IP addresses are captured for security auditing.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from services.db_service import _connect, _connect_ro


def write_audit_log(
    user_id: Optional[int],
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[int] = None,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> int:
    now = datetime.utcnow().isoformat()
    details_json = json.dumps(details) if details else None
    with _connect() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO audit_log
                (user_id, action, resource_type, resource_id, details_json, ip_address, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, action, resource_type, resource_id, details_json, ip_address, now),
        )
        conn.commit()
        return c.lastrowid


def query_audit_log(
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    clauses = []
    params = []

    if user_id is not None:
        clauses.append("user_id = ?")
        params.append(user_id)
    if action:
        clauses.append("action = ?")
        params.append(action)
    if resource_type:
        clauses.append("resource_type = ?")
        params.append(resource_type)
    if date_from:
        clauses.append("al.created_at >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("al.created_at <= ?")
        params.append(date_to)

    where = " AND ".join(clauses) if clauses else "1=1"
    sql = f"""
        SELECT al.*, u.username
        FROM audit_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE {where}
        ORDER BY al.created_at DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    with _connect_ro() as conn:
        rows = conn.execute(sql, params).fetchall()
        results = []
        for row in rows:
            d = dict(row)
            if d.get("details_json"):
                d["details"] = json.loads(d["details_json"])
            else:
                d["details"] = None
            results.append(d)
        return results
