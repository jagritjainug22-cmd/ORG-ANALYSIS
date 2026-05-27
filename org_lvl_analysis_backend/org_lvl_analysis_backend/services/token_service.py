"""
Token service -- JWT access tokens and refresh token lifecycle.

Access tokens: short-lived (15 min), returned in response body, sent as
Bearer header by the frontend. Stateless -- not stored server-side.

Refresh tokens: long-lived (7 days), stored as SHA-256 hash in the DB,
sent/received via httpOnly cookie. Server-side storage enables revocation.
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

import jwt

from services import db_service

JWT_SECRET = os.environ.get("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Access tokens (stateless JWT)
# ---------------------------------------------------------------------------

def create_access_token(user: Dict[str, Any]) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "must_change_password": bool(user["must_change_password"]),
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate an access token. Returns the payload or None."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


# ---------------------------------------------------------------------------
# Refresh tokens (server-side, stored as hash)
# ---------------------------------------------------------------------------

def create_refresh_token(user_id: int) -> str:
    """Create a new refresh token, store its hash in the DB, return the raw token."""
    raw_token = secrets.token_urlsafe(48)
    token_hash = _hash_token(raw_token)
    expires_at = (datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)).isoformat()
    db_service.store_refresh_token(user_id, token_hash, expires_at)
    return raw_token


def validate_refresh_token(raw_token: str) -> Optional[Dict[str, Any]]:
    """Validate a refresh token. Returns the DB row if valid, None otherwise."""
    token_hash = _hash_token(raw_token)
    record = db_service.get_refresh_token(token_hash)
    if not record:
        return None
    if datetime.fromisoformat(record["expires_at"]) < datetime.utcnow():
        db_service.revoke_refresh_token(token_hash)
        return None
    return record


def revoke_refresh_token(raw_token: str) -> None:
    token_hash = _hash_token(raw_token)
    db_service.revoke_refresh_token(token_hash)


def revoke_all_user_tokens(user_id: int) -> None:
    db_service.revoke_all_user_tokens(user_id)


def rotate_refresh_token(old_raw_token: str, user_id: int) -> str:
    """Revoke the old refresh token and issue a new one (token rotation)."""
    revoke_refresh_token(old_raw_token)
    return create_refresh_token(user_id)
