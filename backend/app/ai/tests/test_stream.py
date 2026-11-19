import asyncio

from langchain.messages import AIMessage, AIMessageChunk, ToolMessage

from backend.app.ai.streaming import stream_events


class FakeAgent:
    def __init__(self, items):
        self.items = items

    async def astream(self, *args, **kwargs):
        for item in self.items:
            yield item


def collect(items):
    async def run():
        agent = FakeAgent(items)
        return [event async for event in stream_events(agent, "hi", {})]

    return asyncio.run(run())


def text_chunk(text):
    return ("messages", (AIMessageChunk(content=text), {}))


def thinking_chunk(text="hmm"):
    chunk = AIMessageChunk(content="", additional_kwargs={"reasoning_content": text})
    return ("messages", (chunk, {}))


def model_calls_tool(call):
    return ("updates", {"model": {"messages": [AIMessage(content="", tool_calls=[call])]}})


def tool_finished(status="success"):
    msg = ToolMessage(content="result", tool_call_id="c1", name="web_search", status=status)
    return ("updates", {"tools": {"messages": [msg]}})


CALL = {"name": "web_search", "args": {"query": "x"}, "id": "c1", "type": "tool_call"}


def test_text_and_tool_events():
    items = [
        text_chunk("Hel"),
        thinking_chunk(),
        model_calls_tool(CALL),
        ("messages", (ToolMessage(content="result", tool_call_id="c1", name="web_search"), {})),
        tool_finished(),
        text_chunk("lo"),
        ("updates", {"model": {"messages": [AIMessage(content="Hello")]}}),
    ]

    events = collect(items)

    assert [e.type for e in events] == ["token", "thinking", "tool_start", "tool_end", "token"]
    assert events[0].content == "Hel"
    assert events[4].content == "lo"
    assert events[2].id == events[3].id == "c1"
    assert events[2].name == "web_search"
    assert events[2].args == {"query": "x"}
    assert events[3].ok is True


def test_failed_tool_has_ok_false():
    items = [
        model_calls_tool(CALL),
        tool_finished(status="error"),
    ]

    events = collect(items)

    assert [e.type for e in events] == ["tool_start", "tool_end"]
    assert events[1].ok is False


def test_one_thinking_event_per_phase():
    items = [
        thinking_chunk("a"),
        thinking_chunk("b"),
        thinking_chunk("c"),
        model_calls_tool(CALL),
        thinking_chunk("d"),
        thinking_chunk("e"),
    ]

    events = collect(items)

    assert [e.type for e in events] == ["thinking", "tool_start", "thinking"]