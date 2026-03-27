import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import (
    BOOTSTRAP_SECRET,
    generate_invite_validation_token,
    get_current_user,
    verify_authing_token,
    verify_invite_validation_token,
)
from database import db

router = APIRouter(tags=["auth"])


class ValidateInviteRequest(BaseModel):
    code: str


class RegisterRequest(BaseModel):
    id_token: str
    invite_token: str


class LoginRequest(BaseModel):
    id_token: str


class BootstrapRequest(BaseModel):
    id_token: str
    bootstrap_secret: str


@router.post("/validate-invite")
async def validate_invite(req: ValidateInviteRequest):
    """Check invite code validity, return a short-lived HMAC validation token."""
    entry = db.get_invite_code(req.code)
    if not entry:
        raise HTTPException(status_code=400, detail="Invalid invite code")
    if not entry["is_active"]:
        raise HTTPException(status_code=400, detail="Invite code already used or revoked")
    if entry["expires_at"]:
        from datetime import datetime
        if datetime.utcnow().isoformat() > entry["expires_at"]:
            raise HTTPException(status_code=400, detail="Invite code has expired")
    validation_token = generate_invite_validation_token(req.code)
    return {"valid": True, "validation_token": validation_token}


@router.post("/register", status_code=201)
async def register(req: RegisterRequest):
    """Verify Authing JWT + invite token, create app user."""
    # Verify JWT
    claims = await verify_authing_token(req.id_token)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    # Verify invite token and get code
    code = verify_invite_validation_token(req.invite_token)

    # Check invite code still valid (race condition guard)
    entry = db.get_invite_code(code)
    if not entry or not entry["is_active"]:
        raise HTTPException(status_code=400, detail="Invite code no longer valid")

    # Check user doesn't already exist
    existing = db.get_user_by_sub(sub)
    if existing:
        raise HTTPException(status_code=409, detail="User already registered")

    email = claims.get("email") or claims.get("preferred_username")
    username = claims.get("name") or claims.get("nickname") or email

    user_id = db.create_user(authing_sub=sub, email=email, username=username, role="user")
    db.use_invite_code(code, user_id)

    return {"user_id": user_id, "role": "user"}


@router.post("/login")
async def login(req: LoginRequest):
    """Verify Authing JWT, update last_login, return role."""
    claims = await verify_authing_token(req.id_token)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    user = db.get_user_by_sub(sub)
    if not user:
        raise HTTPException(status_code=401, detail="User not registered. Use an invite code to sign up.")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account is disabled")

    db.update_user_last_login(user["id"])
    return {"user_id": user["id"], "role": user["role"], "email": user["email"],
            "username": user["username"]}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"],
        "email": user["email"],
        "username": user["username"],
        "role": user["role"],
        "created_at": user["created_at"],
        "last_login": user["last_login"],
    }


@router.post("/bootstrap")
async def bootstrap(req: BootstrapRequest):
    """One-time admin bootstrap. Disabled after first use."""
    if not BOOTSTRAP_SECRET:
        raise HTTPException(status_code=503, detail="Bootstrap not configured")
    if req.bootstrap_secret != BOOTSTRAP_SECRET:
        raise HTTPException(status_code=403, detail="Invalid bootstrap secret")
    if db.get_app_config("bootstrap_done") == "true":
        raise HTTPException(status_code=410, detail="Bootstrap already completed")

    claims = await verify_authing_token(req.id_token)
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    email = claims.get("email") or claims.get("preferred_username")
    username = claims.get("name") or claims.get("nickname") or email

    existing = db.get_user_by_sub(sub)
    if existing:
        db.update_user(existing["id"], role="admin")
        user_id = existing["id"]
    else:
        user_id = db.create_user(authing_sub=sub, email=email, username=username, role="admin")

    db.set_app_config("bootstrap_done", "true")
    return {"user_id": user_id, "role": "admin", "message": "Admin bootstrapped successfully"}
