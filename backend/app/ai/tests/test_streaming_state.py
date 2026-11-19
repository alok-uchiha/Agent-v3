import asyncio

from backend.app.ai.streaming import ThinkingEvent, stream_events


def test_stream_emits_thinking_before_model_starts():
    class Agent:
        started = False

        async def astream(self, inputs, config, stream_mode):
            assert inputs and config == {} and stream_mode == ["messages", "updates"]
            self.started = True
            yield "updates", {}

    async def check_first_event():
        agent = Agent()
        events = stream_events(agent, "hello", {})
        event = await anext(events)
        await events.aclose()
        return agent, event

    agent, event = asyncio.run(check_first_event())

    assert isinstance(event, ThinkingEvent)
    assert event.model_dump() == {"type": "thinking"}
    assert not agent.started
