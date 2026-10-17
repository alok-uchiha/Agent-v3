import pytest
from pydantic import ValidationError

from backend.app.ai.config.settings import Setting

def test_invalid_environment_is_rejected():
    with pytest.raises(ValidationError):
        Setting(_env_file=None, app_env="prodution")

from backend.app.api.routes.chat import _should_emit_stream_chunk


def test_stream_emits_model_tokens():
    assert _should_emit_stream_chunk({"langgraph_node": "model"}) is True
    assert _should_emit_stream_chunk({"langgraph_node": "agent"}) is True
    assert _should_emit_stream_chunk({"langgraph_node": "tools"}) is False
