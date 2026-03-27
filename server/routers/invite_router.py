import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_admin
from database import db

router = APIRouter(tags=["invites"])


def _generate_code() -> str:
    raw = secrets.token_hex(6).upper()
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:12]}"


class CreateInvitesRequest(BaseModel):
    count: int = 1
    expires_in_days: Optional[int] = None


@router.get("")
async def list_invites(admin: dict = Depends(require_admin)):
    return db.list_invite_codes()


@router.post("", status_code=201)
async def create_invites(req: CreateInvitesRequest, admin: dict = Depends(require_admin)):
    if req.count < 1 or req.count > 50:
        raise HTTPException(status_code=400, detail="count must be between 1 and 50")
    expires_at = None
    if req.expires_in_days:
        expires_at = (datetime.utcnow() + timedelta(days=req.expires_in_days)).isoformat()
    codes = []
    for _ in range(req.count):
        code = _generate_code()
        db.create_invite_code(code=code, created_by=admin["id"], expires_at=expires_at)
        codes.append(code)
    return {"codes": codes}


@router.delete("/{code}", status_code=204)
async def revoke_invite(code: str, admin: dict = Depends(require_admin)):
    entry = db.get_invite_code(code)
    if not entry:
        raise HTTPException(status_code=404, detail="Invite code not found")
    db.deactivate_invite_code(code)
