from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

import jwt
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.db.database import AsyncSessionLocal
from backend.app.core.config import SECRET_KEY, ALGORITHM
from backend.app.db.models import User



async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

async def get_user(
        token:str = Depends(oauth2_scheme),
        db: AsyncSession = Depends(get_db),
) -> User :
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )

        user_id = payload.get("sub")

        if user_id is None:
            raise credentials_exception

    except jwt.PyJWTError:
        raise credentials_exception


    result = await db.execute(
        select(User).where(
            User.id==user_id
        )
    )

    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    return user

    