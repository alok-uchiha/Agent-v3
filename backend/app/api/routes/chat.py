import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from langchain.messages import HumanMessage

from backend.app.core.dependency import get_db, get_user
from backend.app.db.models import Conversation, Message, User
from backend.app.schemas.message import MessageCreate
from backend.app.ai.agent.agent import model

router = APIRouter(prefix="/chat", tags=["chat"])


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p if isinstance(p, str) else p.get("text", "") for p in content)
    return ""


# ---------- Existing routes ----------
@router.post("")
async def chat(
    message: MessageCreate,
    current_user: Annotated[User, Depends(get_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Conversation).where(Conversation.user_id == current_user.id)
    )
    conversation = result.scalars().first()

    if conversation is None:
        conversation = Conversation(user_id=current_user.id, title="my_chat")
        db.add(conversation)
        await db.flush()

    new_message = Message(
        conversation_id=conversation.id,
        role="user",
        content=message.content,
    )
    db.add(new_message)
    await db.commit()
    await db.refresh(new_message)

    return {
        "conversation_id": conversation.id,
        "message_id": new_message.id,
        "role": new_message.role,
        "user": current_user.username,
        "content": new_message.content,
    }


@router.get("/{conversation_id}")
async def get_convo(
    conversation_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_user)],
):
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conversation = result.scalar_one_or_none()

    if conversation is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    if conversation.user_id != current_user.id:
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at)
    )
    messages = result.scalars().all()

    return {
        "conversation_id": conversation.id,
        "user": current_user.username,
        "messages": [
            {"message_id": m.id, "role": m.role, "content": m.content}
            for m in messages
        ],
    }

@router.post("/ai/stream")
async def ai_stream(
    input: str,
    current_user:Annotated[User, Depends(get_user)]
):

    config = {"configurable": {"thread_id": f"user-{current_user.id}"}}
    
    async def event_gen():
        try:
            async for chunk, meta in model.astream(
                {"messages": [HumanMessage(input)]},
                config=config,
                stream_mode="messages",
            ):
                # only the main model's text, not tool results or the summarizer
                if meta.get("langgraph_node") != "model":
                    continue
                token = _text(chunk.content)
                if token:
                    yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': 'The agent hit an error. Try again.'})}\n\n"
            print("stream error:", e)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )