import json
import logging
import time
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from langchain.messages import HumanMessage

from backend.app.core.dependency import get_db, get_user
from backend.app.db.models import Conversation, Message, User
from backend.app.schemas.message import ChatRequest, ConversationCreate, ConversationRename
from backend.app.ai.agent.agent import agent
from backend.app.db.database import AsyncSessionLocal

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])

MAX_INPUT_CHARS = 4000
MAX_TITLE_CHARS = 80


# ---------- small helpers ----------
def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            p if isinstance(p, str) else p.get("text", "") for p in content
        )
    if isinstance(content, dict):
        return content.get("text", "")
    return ""


def _should_emit_stream_chunk(meta: dict | None) -> bool:
    node = (meta or {}).get("langgraph_node")
    return node in {"agent", "model"} or node is None


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def _clean_title(title: str | None) -> str:
    return " ".join((title or "").split())[:MAX_TITLE_CHARS]


async def get_owned_conversation(
    db: AsyncSession, conversation_id: int, user_id: int
) -> Conversation:
    # The owner check is part of the query, so someone else's chat looks exactly
    # like a chat that doesn't exist. 404 (never 401: the frontend reads a 401
    # as "your session expired" and logs the user out).
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == user_id,
        )
    )
    convo = result.scalar_one_or_none()
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo


async def _save_reply(conversation_id: int, text: str) -> int | None:
    """Store the assistant's reply in its OWN session.

    The request's `db` session may already be closed by the time a stream ends.
    """
    try:
        async with AsyncSessionLocal() as s:
            msg = Message(conversation_id=conversation_id, role="assistant", content=text)
            s.add(msg)
            await s.flush()
            msg_id = msg.id
            await s.execute(
                update(Conversation)
                .where(Conversation.id == conversation_id)
                .values(updated_at=func.now())
            )
            await s.commit()
            return msg_id
    except Exception:
        logger.exception("could not save the assistant reply (conversation %s)", conversation_id)
        return None


# ---------- conversations ----------
@router.post("/conversations", status_code=201)
async def create_conversation(
    body: ConversationCreate,
    current_user: Annotated[User, Depends(get_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    convo = Conversation(
        user_id=current_user.id,
        title=_clean_title(body.title) or "New chat",
    )
    db.add(convo)
    await db.commit()
    await db.refresh(convo)

    return {
        "id": convo.id,
        "title": convo.title,
        "created_at": _iso(convo.created_at),
        "updated_at": _iso(convo.updated_at or convo.created_at),
    }


@router.get("/conversations")
async def list_conversations(
    current_user: Annotated[User, Depends(get_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == current_user.id)
        .order_by(
            func.coalesce(Conversation.updated_at, Conversation.created_at).desc(),
            Conversation.id.desc(),
        )
    )
    convos = result.scalars().all()

    return {
        "conversations": [
            {
                "id": c.id,
                "title": c.title,
                "created_at": _iso(c.created_at),
                "updated_at": _iso(c.updated_at or c.created_at),
            }
            for c in convos
        ]
    }


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: int,
    current_user: Annotated[User, Depends(get_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    convo = await get_owned_conversation(db, conversation_id, current_user.id)

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == convo.id)
        .order_by(Message.id)
    )
    messages = result.scalars().all()

    return {
        "id": convo.id,
        "title": convo.title,
        "created_at": _iso(convo.created_at),
        "updated_at": _iso(convo.updated_at or convo.created_at),
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "created_at": _iso(m.created_at),
            }
            for m in messages
        ],
    }


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(
    conversation_id: int,
    body: ConversationRename,
    current_user: Annotated[User, Depends(get_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    title = _clean_title(body.title)
    if not title:
        raise HTTPException(status_code=422, detail="The title can't be empty")

    convo = await get_owned_conversation(db, conversation_id, current_user.id)
    convo.title = title
    await db.commit()
    return {"id": conversation_id, "title": title}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: int,
    current_user: Annotated[User, Depends(get_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    convo = await get_owned_conversation(db, conversation_id, current_user.id)
    await db.execute(delete(Message).where(Message.conversation_id == convo.id))
    await db.delete(convo)
    await db.commit()
    return {"deleted": conversation_id}


# ---------- the assistant ----------
@router.post("/conversations/{conversation_id}/stream")
async def stream_reply(
    conversation_id: int,
    body: ChatRequest,
    current_user: Annotated[User, Depends(get_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    prompt = body.content.strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="The message can't be empty")
    if len(prompt) > MAX_INPUT_CHARS:
        raise HTTPException(
            status_code=422,
            detail=f"That message is too long (max {MAX_INPUT_CHARS} characters)",
        )

    # Plain ints from here on: ORM objects expire after commit() and must not be
    # touched again inside the stream.
    user_id = current_user.id
    convo = await get_owned_conversation(db, conversation_id, user_id)
    thread_id = str(convo.id)

    # "Retry" after a failed reply sends the same text again. If the newest message
    # is already this question (and nothing answered it), don't store it twice.
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.id.desc())
        .limit(1)
    )
    last = result.scalar_one_or_none()
    if not (last is not None and last.role == "user" and last.content == prompt):
        db.add(Message(conversation_id=conversation_id, role="user", content=prompt))
    convo.updated_at = func.now()
    await db.commit()

    config = {"configurable": {"thread_id": thread_id, "user_id": user_id}}

    async def event_gen():
        parts: list[str] = []
        assistant_id = None
        t0 = time.perf_counter()
        seen_chunk = seen_token = False

        # First bytes out right away, so proxies start passing the stream along
        yield ": stream open\n\n"

        try:
            async for chunk, meta in agent.astream(
                {"messages": [HumanMessage(prompt)]},
                config=config,
                stream_mode="messages",
            ):
                if not seen_chunk:
                    seen_chunk = True
                    print(f"[timing] chat {conversation_id}: first chunk after "
                          f"{time.perf_counter() - t0:.2f}s (node={(meta or {}).get('langgraph_node')})", flush=True)
                if not _should_emit_stream_chunk(meta):
                    continue
                token = _text(chunk.content)
                if not token:
                    continue
                if not seen_token:
                    seen_token = True
                    print(f"[timing] chat {conversation_id}: first text after "
                          f"{time.perf_counter() - t0:.2f}s", flush=True)
                parts.append(token)
                yield _sse({"type": "token", "content": token})
        except Exception:
            logger.exception("agent stream failed (conversation %s)", conversation_id)
            yield _sse({"type": "error", "message": "The agent hit an error. Try again."})
        finally:
            # Runs after a normal finish, after an error, AND when the user presses
            # Stop (the client disconnects and this task is cancelled). The shield
            # lets the save go through even though the task is being cancelled.
            reply = "".join(parts)
            if reply:
                with anyio.CancelScope(shield=True):
                    assistant_id = await _save_reply(conversation_id, reply)

        yield _sse({"type": "done", "assistant_message_id": assistant_id})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )