"""
User service -- password hashing and authentication logic.

Uses argon2id (via argon2-cffi) for password hashing. All user persistence
is in db_service.py; this module handles the crypto and validation layer.
"""

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from typing import Optional, Dict, Any

from services import db_service

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def authenticate(username: str, password: str) -> Optional[Dict[str, Any]]:
    """Validate credentials. Returns the user dict on success, None on failure."""
    username = username.strip()
    user = db_service.get_user_by_username(username)
    if not user:
        return None
    if not user["is_active"]:
        return None
    if not verify_password(password, user["password_hash"]):
        return None
    return user


def change_password(user_id: int, old_password: str, new_password: str) -> bool:
    """Change a user's password. Returns True on success, False if old password is wrong."""
    user = db_service.get_user_by_id(user_id)
    if not user:
        return False
    if not verify_password(old_password, user["password_hash"]):
        return False
    new_hash = hash_password(new_password)
    db_service.update_user_password(user_id, new_hash, clear_must_change=True)
    return True


def force_change_password(user_id: int, new_password: str) -> None:
    """Set a new password without verifying the old one (admin reset, first login)."""
    new_hash = hash_password(new_password)
    db_service.update_user_password(user_id, new_hash, clear_must_change=True)
