import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session
from typing import Annotated

from app.config import get_settings
from app.db import get_db
from app.errors import AuthenticationError

_DUMMY_HASH: bytes | None = None


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if encoded == b"" or len(encoded) > 72:
        raise ValueError("password_length")
    rounds = get_settings().bcrypt_rounds
    if rounds < 12 and os.environ.get("ALLOW_TEST_BCRYPT") != "1":
        rounds = 12
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=rounds)).decode("ascii")


def verify_password(password: str, password_hash: str | None) -> bool:
    encoded = password.encode("utf-8")
    if encoded == b"" or len(encoded) > 72:
        bcrypt.checkpw(b"invalid", _dummy_hash())
        return False
    if password_hash is None:
        bcrypt.checkpw(encoded, _dummy_hash())
        return False
    try:
        return bcrypt.checkpw(encoded, password_hash.encode("ascii"))
    except ValueError:
        return False


def create_token(user_id: UUID) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=settings.token_ttl_seconds),
    }
    return jwt.encode(payload, settings.token_secret, algorithm="HS256")


def read_user_id(token: str) -> UUID:
    """Read only sub. role and user_metadata are ignored even inside a signed token."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.token_secret, algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise AuthenticationError from error
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise AuthenticationError
    try:
        return UUID(subject)
    except ValueError as error:
        raise AuthenticationError from error


def current_user(
    authorization: Annotated[str | None, Header()] = None,
    session: Session = Depends(get_db),
):
    from app.models import Account

    if authorization is None or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="not_authenticated")
    token = authorization.split(" ", 1)[1].strip()
    try:
        user_id = read_user_id(token)
    except AuthenticationError as error:
        raise HTTPException(status_code=401, detail="not_authenticated") from error
    account = session.get(Account, user_id)
    if account is None:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return account


def _dummy_hash() -> bytes:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        rounds = get_settings().bcrypt_rounds
        if rounds < 4:
            rounds = 4
        _DUMMY_HASH = bcrypt.hashpw(b"not-a-user", bcrypt.gensalt(rounds=rounds))
    return _DUMMY_HASH
