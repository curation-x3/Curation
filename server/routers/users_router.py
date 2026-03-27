from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_admin
from database import db

router = APIRouter(tags=["users"])


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("")
async def list_users(admin: dict = Depends(require_admin)):
    return db.list_users()


@router.patch("/{user_id}")
async def update_user(user_id: int, req: UpdateUserRequest,
                      admin: dict = Depends(require_admin)):
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if req.role and req.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be 'admin' or 'user'")
    db.update_user(user_id, role=req.role, is_active=req.is_active)
    return db.get_user_by_id(user_id)
