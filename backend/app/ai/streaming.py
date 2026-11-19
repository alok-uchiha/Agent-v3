from collections.abc import AsyncIterator
from typing import Literal

from langchain.messages import HumanMessage, AIMessageChunk, ToolMessage, AIMessage
from pydantic import BaseModel


class ThinkingEvent(BaseModel):
    type:Literal["thinking"] = "thinking"

class TokenEvent(BaseModel):
    type:Literal["token"] = "token"
    content : str

class ToolStartEvent(BaseModel):
    type:Literal["tool_start"] = "tool_start"
    id : str
    name : str
    args: dict

class ToolEndEvent(BaseModel):
    type:Literal["tool_end"] = "tool_end"
    id:str
    name: str
    ok:bool

StreamEvent = ThinkingEvent | TokenEvent | ToolStartEvent | ToolEndEvent

def _text(content) -> str:

    if isinstance(content, str):
        return content
    
    if isinstance(content, list):
        return "".join(p if isinstance(p,str) else p.get("text", "") for p in content)
    
    if isinstance(content, dict):
        return content.get("text","")
    return ""

def _is_thinking(chunk:AIMessageChunk) -> bool:
    return bool(chunk.additional_kwargs.get("reasoning_content"))


async def stream_events(agent, prompt:str, config:dict) -> AsyncIterator[StreamEvent]:
    yield ThinkingEvent()
    thinking_sent = True
    async for mode, data in agent.astream(
        {"messages":[HumanMessage(prompt)]},
        config=config,
        stream_mode=["messages", "updates"],
    ):
        if mode == "messages":
            chunk, _meta = data
            if isinstance(chunk, AIMessageChunk):
                text = _text(chunk.content)
                if text:
                    yield TokenEvent(content=text)
                elif _is_thinking(chunk) and not thinking_sent:
                    thinking_sent = True
                    yield ThinkingEvent()

        elif mode == "updates":
            thinking_sent = False
            for _node, update in data.items():
                if not isinstance(update, dict):
                    continue
                for msg in update.get("messages", []):
                    if isinstance(msg, AIMessage):
                        for call in msg.tool_calls:
                            yield ToolStartEvent(
                                id = call.get("id") or "",
                                name = call["name"],
                                args= call["args"],
                            )
                    elif isinstance(msg, ToolMessage):
                        yield ToolEndEvent(
                            id= msg.tool_call_id,
                            name = msg.name or "tool",
                            ok=msg.status == "success",
                        )
