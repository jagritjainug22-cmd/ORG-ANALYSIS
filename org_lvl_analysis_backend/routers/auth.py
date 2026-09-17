"""
Auth router -- login, logout, token refresh, password change.

Token strategy:
- Access token: 15min JWT, returned in response body, sent as Bearer header
- Refresh token: 7-day opaque token, set as httpOnly cookie, stored hashed in DB

CSRF protection:
- /auth/refresh requires X-Requested-With: fetch header (blocks cross-origin
  form POSTs that would auto-attach the cookie without passing CORS preflight)
"""

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg import OperationalError
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

IS_PRODUCTION = os.environ.get("ENVIRONMENT") == "production"

from dependencies.auth import (
    get_current_user,
    get_current_user_allow_password_change,
)
from services import user_service, token_service
from services.logging_service import write_activity_log

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=IS_PRODUCTION,
        samesite="lax",
        max_age=REFRESH_COOKIE_MAX_AGE,
        path="/auth",  # only sent to /auth/* endpoints
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/auth",
    )


@router.post("/login")
async def login(body: LoginRequest, response: Response, request: Request):
    user = user_service.authenticate(body.username, body.password)
    if not user:
        write_activity_log(
            username=body.username,
            action="login",
            status="error",
            details="Invalid credentials",
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = token_service.create_access_token(user)
    refresh_raw = token_service.create_refresh_token(user["id"])
    _set_refresh_cookie(response, refresh_raw)

    write_activity_log(
        username=user["username"],
        action="login",
        status="success",
        details="User logged in successfully",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "must_change_password": bool(user["must_change_password"]),
        },
    }


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    client_ip = request.client.host if request.client else "unknown"

    # CSRF protection: require custom header that cross-origin forms can't set
    if request.headers.get("X-Requested-With") != "fetch":
        logger.warning("auth/refresh: CSRF check failed from %s", client_ip)
        raise HTTPException(
            status_code=403,
            detail="Missing X-Requested-With header (CSRF protection)",
        )

    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_token:
        logger.warning("auth/refresh: no refresh cookie from %s", client_ip)
        raise HTTPException(status_code=401, detail="No refresh token")

    token_preview = raw_token[-8:] if raw_token else "(none)"
    logger.info("auth/refresh: attempt from %s token=...%s", client_ip, token_preview)

    try:
        token_record = token_service.validate_refresh_token(raw_token)
    except OperationalError:
        logger.warning("auth/refresh: DB unavailable during token validation from %s", client_ip)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not token_record:
        logger.warning(
            "auth/refresh: INVALID or EXPIRED token ...%s from %s — "
            "this causes a 401. Likely the token was already rotated "
            "(race condition) or the 7-day TTL expired.",
            token_preview, client_ip,
        )
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    try:
        from services import db_service
        user = db_service.get_user_by_id(token_record["user_id"])
    except OperationalError:
        logger.warning("auth/refresh: DB unavailable during user lookup from %s", client_ip)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not user or not user["is_active"]:
        logger.warning(
            "auth/refresh: user %s is deactivated or not found from %s",
            token_record.get("user_id"), client_ip,
        )
        token_service.revoke_refresh_token(raw_token)
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="User account is deactivated")

    try:
        new_refresh_raw = token_service.rotate_refresh_token(raw_token, user["id"])
    except OperationalError:
        logger.warning("auth/refresh: DB unavailable during token rotation from %s", client_ip)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    _set_refresh_cookie(response, new_refresh_raw)
    access_token = token_service.create_access_token(user)

    logger.info(
        "auth/refresh: SUCCESS for user=%s from %s old=...%s new=...%s",
        user["username"], client_ip, token_preview, new_refresh_raw[-8:],
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "role": user["role"],
            "must_change_password": bool(user["must_change_password"]),
        },
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    user: dict = Depends(get_current_user_allow_password_change),
):
    try:
        from services.lock_service import release_all_user_locks
        release_all_user_locks(user["id"])
    except Exception:
        pass  # best-effort; 90s expiry is the safety net
    try:
        from services.dataset_lock_service import release_all_user_locks as release_all_ds_locks
        release_all_ds_locks(user["id"])
    except Exception:
        pass
    try:
        from services import duckdb_manager
        duckdb_manager.close(user["id"])
    except Exception:
        pass

    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw_token:
        token_service.revoke_refresh_token(raw_token)
    _clear_refresh_cookie(response)

    write_activity_log(
        username=user["username"],
        action="logout",
        status="success",
        details="User logged out",
    )

    return {"status": "logged out"}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: dict = Depends(get_current_user_allow_password_change),
):
    if len(body.new_password) < 5:
        raise HTTPException(
            status_code=400,
            detail="New password must be at least 5 characters",
        )

    if body.old_password == body.new_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from old password",
        )

    success = user_service.change_password(
        user["id"], body.old_password, body.new_password
    )
    if not success:
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Revoke all existing refresh tokens so the user must re-login
    # with the new password (prevents stale sessions)
    token_service.revoke_all_user_tokens(user["id"])

    write_activity_log(
        username=user["username"],
        action="change_password",
        status="success",
        details="Password changed" + (" (first login)" if user["must_change_password"] else ""),
    )

    return {"status": "password_changed"}
