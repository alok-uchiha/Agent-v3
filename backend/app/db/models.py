from sqlalchemy import String, Text, DATETIME, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db.database import Base

from pydantic import ConfigDict
from datetime import datetime


class User(Base):
    __tablename__="users"

    id:Mapped[int]=mapped_column(primary_key=True)
    username:Mapped[str]=mapped_column(String(50) ,unique=True, nullable=False, index=True)
    email:Mapped[str]=mapped_column(String(100), unique=True, nullable=False, index=True)
    hashed_password:Mapped[str]=mapped_column(String(200),nullable=False)
    bio:Mapped[str]=mapped_column(Text, nullable=True)
    created_at:Mapped[datetime]=mapped_column(DATETIME,default=datetime.now, index=True)
    updated_at:Mapped[datetime]=mapped_column(DATETIME, default=datetime.now, onupdate=datetime.now)

    model_config= ConfigDict(from_attributes=True)

    conversations: Mapped[list["Conversation"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan"
    )

    orders: Mapped[list["Order"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan"
    )
    
    
class Conversation(Base):
    __tablename__="conversations"

    id:Mapped[int]=mapped_column(primary_key=True)
    user_id:Mapped[int]=mapped_column(ForeignKey("users.id"), index=True)
    title:Mapped[str | None]=mapped_column(String(200),nullable=True, index=True)
    created_at:Mapped[datetime]=mapped_column(DATETIME, default=datetime.now, index=True)
    updated_at:Mapped[datetime]=mapped_column(DATETIME, default=datetime.now, onupdate=datetime.now)

    user:Mapped["User"] = relationship(back_populates="conversations")
    messages:Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan") 

class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME, default=datetime.now)

    
    conversation: Mapped["Conversation"] = relationship(back_populates="messages")

class Order(Base):
    __tablename__="orders"

    id:Mapped[int]=mapped_column(primary_key=True)
    user_id:Mapped[int]=mapped_column(ForeignKey("users.id"), index=True)
    order_id:Mapped[str]=mapped_column(String(20), unique=True,nullable=False, index=True)
    product:Mapped[str]=mapped_column(String(100), nullable=False, index=True)
    ordered_at:Mapped[datetime]=mapped_column(DATETIME, default=datetime.now, index=True)

    user:Mapped["User"]=relationship(back_populates="orders")