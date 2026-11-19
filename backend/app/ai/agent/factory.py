from langchain.agents import create_agent
from langchain_openrouter import ChatOpenRouter

from backend.app.ai.config.settings import get_setting
from backend.app.ai.agent.spec import AgentSpec


def build_model(name : str | None = None) -> ChatOpenRouter:
    s = get_setting()

    if s.openrouter_api_key is None:
        raise RuntimeError("OpenRouter API key is missing")

    model_name = name or s.default_model
    if model_name.startswith("openrouter:"):
        model_name = model_name.removeprefix("openrouter:")

    return ChatOpenRouter(
        model=model_name,
        api_key=s.openrouter_api_key,
        base_url=str(s.openrouter_base_url),
        max_retries=s.max_retries,
        timeout=max(1, round(s.request_timeout_seconds * 1000)),
    )


def build_agent(spec:AgentSpec, checkpointer= None):
    return create_agent(
        model= build_model(spec.model),
        tools=list(spec.tools),
        system_prompt=spec.prompt,
        checkpointer=checkpointer,
    )