from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import profile_from_token
from app.models import Profile

bearer_scheme = HTTPBearer(auto_error=False)


def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> Profile | None:
    if credentials is None or not credentials.credentials:
        return None
    return profile_from_token(credentials.credentials, db)


def get_current_user(
    user: Annotated[Profile | None, Depends(get_optional_user)],
) -> Profile:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_admin(user: Annotated[Profile, Depends(get_current_user)]) -> Profile:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


def require_approved_teacher(user: Annotated[Profile, Depends(get_current_user)]) -> Profile:
    if user.role != "teacher" or user.teacher_status != "approved":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approved teachers only")
    return user
