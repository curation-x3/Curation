"""
Authentication helpers: Authing JWKS-based JWT verification + FastAPI dependencies.
"""
import hashlib
import hmac
import logging
import os
import time
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from jose.utils import base64url_decode

from database import db

logger = logging.getLogger(__name__)

AUTHING_APP_ID = os.environ.get("AUTHING_APP_ID", "")
AUTHING_ISSUER = os.environ.get("AUTHING_ISSUER", "")
AUTHING_JWKS_URI = os.environ.get("AUTHING_JWKS_URI", "")
INVITE_SECRET = os.environ.get("INVITE_SECRET", "changeme-set-INVITE_SECRET-in-env")
BOOTSTRAP_SECRET = os.environ.get("BOOTSTRAP_SECRET", "")

# ---------------------------------------------------------------------------
# JWKS cache
# ---------------------------------------------------------------------------

_jwks_keys: list = []
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600  # 1 hour


async def _get_jwks_keys() -> list:
    global _jwks_keys, _jwks_fetched_at
    if _jwks_keys and (time.time() - _jwks_fetched_at) < _JWKS_TTL:
        return _jwks_keys
    if not AUTHING_JWKS_URI:
        raise HTTPException(status_code=500, detail="AUTHING_JWKS_URI not configured")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(AUTHING_JWKS_URI)
        resp.raise_for_status()
        data = resp.json()
    _jwks_keys = data.get("keys", [])
    _jwks_fetched_at = time.time()
    return _jwks_keys


# ---------------------------------------------------------------------------
# JWT verification
# ---------------------------------------------------------------------------

async def verify_authing_token(token: str) -> dict:
    """Verify an Authing id_token (RS256). Returns the decoded claims dict."""
    try:
        # Decode header to get kid
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        keys = await _get_jwks_keys()

        # Find matching key
        matching = next((k for k in keys if k.get("kid") == kid), None)
        if not matching and keys:
            # Fallback: use first key if only one key
            matching = keys[0] if len(keys) == 1 else None
        if not matching:
            raise HTTPException(status_code=401, detail="No matching JWKS key found")

        claims = jwt.decode(
            token,
            matching,
            algorithms=["RS256"],
            audience=AUTHING_APP_ID or None,
            issuer=AUTHING_ISSUER or None,
            options={"verify_aud": bool(AUTHING_APP_ID), "verify_iss": bool(AUTHING_ISSUER)},
        )
        return claims
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Authorization header required")
    claims = await verify_authing_token(credentials.credentials)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")
    user = db.get_user_by_sub(sub)
    if not user:
        raise HTTPException(status_code=401, detail="User not registered in this app")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account is disabled")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


async def get_current_user_ws(token: str = Query(...)) -> dict:
    """WebSocket variant: token passed as query param."""
    claims = await verify_authing_token(token)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")
    user = db.get_user_by_sub(sub)
    if not user or not user["is_active"]:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


# ---------------------------------------------------------------------------
# HMAC invite validation token
# ---------------------------------------------------------------------------

_INVITE_TOKEN_TTL = 600  # 10 minutes


def generate_invite_validation_token(code: str) -> str:
    exp = int(time.time()) + _INVITE_TOKEN_TTL
    payload = f"{code}:{exp}"
    sig = hmac.new(
        INVITE_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload}:{sig}"


def verify_invite_validation_token(token: str) -> str:
    """Verify the HMAC token and return the embedded invite code, or raise 400."""
    try:
        parts = token.rsplit(":", 1)
        if len(parts) != 2:
            raise ValueError("bad format")
        payload, sig = parts
        expected_sig = hmac.new(
            INVITE_SECRET.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            raise ValueError("invalid signature")
        code_part, exp_str = payload.rsplit(":", 1)
        if int(time.time()) > int(exp_str):
            raise ValueError("expired")
        return code_part
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid invite validation token: {e}")
