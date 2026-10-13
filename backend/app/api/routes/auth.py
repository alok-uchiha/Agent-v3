from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from typing import Annotated

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from backend.app.schemas.user import UserResponse, UserCreate, Token
from backend.app.core.dependency import get_db
from backend.app.db.models import User
from backend.app.core.secuirty import hash_password, verify_password, create_access_token


router=APIRouter(prefix="/auth", tags=["auth"])

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED
)
async def register(
    user_data:UserCreate,
    db:Annotated[AsyncSession, Depends(get_db)]
):
    result= await db.execute(
        select(User).where(or_(
            user_data.username==User.username,
            user_data.email==User.email
        ))
    )

    existing_user=result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            detail="Username or email already exists",
            status_code=status.HTTP_400_BAD_REQUEST
        )

    user = user_data.model_dump(exclude_unset=True)

    user['hashed_password']=hash_password(user_data.password)
    user.pop('password')

    new_user=User(**user)

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return new_user

@router.post(
    "/login",
    response_model=Token
)
async def login(
    user_data:Annotated[OAuth2PasswordRequestForm, Depends()],
    db:Annotated[AsyncSession, Depends(get_db)]
):

    result = await db.execute(
        select(User).where(or_(
            user_data.username==User.email,
            user_data.username==User.username
                            ))
    )

    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            detail="Invalid email or password",
            status_code=status.HTTP_401_UNAUTHORIZED
        )

    if not verify_password(
        user_data.password,
        user.hashed_password
        ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid email or password"
        )

    access_token= create_access_token(user.id)

    return {
        "access_token": access_token,
        "token_type": "bearer",
    }