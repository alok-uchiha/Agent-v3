import pytest

from dataclasses import FrozenInstanceError

from backend.app.ai.agent.spec import AgentSpec
from backend.app.ai.agent.register import AGENTS



def test_spec_is_frozen():
    spec = AgentSpec(name="test",prompt="check ts")
    with pytest.raises(FrozenInstanceError):
        spec.name = "chnaged"


def test_registry_has_reseacher():
    assert "researcher"in AGENTS

    assert len(AGENTS["researcher"].tools) == 1