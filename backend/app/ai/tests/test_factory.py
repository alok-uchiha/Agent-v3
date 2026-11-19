from types import SimpleNamespace

from pydantic import SecretStr

from backend.app.ai.agent import factory


def test_build_model_converts_legacy_model_name_and_timeout(monkeypatch):
    monkeypatch.setattr(
        factory,
        "get_setting",
        lambda: SimpleNamespace(
            openrouter_api_key=SecretStr("test-key"),
            default_model="openrouter:nvidia/nemotron-3.5-super-vl:free",
            openrouter_base_url="https://openrouter.ai/api/v1",
            max_retries=2,
            request_timeout_seconds=60.0,
        ),
    )

    model = factory.build_model()

    assert model.model_name == "nvidia/nemotron-3.5-super-vl:free"
    assert model.request_timeout == 60_000
