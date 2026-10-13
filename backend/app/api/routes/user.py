from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
import string, secrets

from typing import Annotated

from backend.app.core.dependency import get_user, get_db
from backend.app.db.models import User, Order
from backend.app.schemas.user import UserResponse


router = APIRouter(
    prefix="/user",
    tags=["user"]
)


@router.get(
        "/me",
        response_model=UserResponse
        )
async def me(
    current_user:Annotated[User, Depends(get_user)]
):
    return current_user

@router.post("/order")
async def order(
    product:str,
    db:Annotated[AsyncSession, Depends(get_db)],
    current_user:Annotated[User, Depends(get_user)]
):

    new_order = Order(
        user_id=current_user.id,
        order_id = "ORD-" + ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8)),
        product=product
    )

    db.add(new_order)
    await db.commit()
    await db.refresh(new_order)

    return new_order