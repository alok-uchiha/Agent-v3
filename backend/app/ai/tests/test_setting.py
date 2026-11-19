
import pytest

from pydantic import SecretStr, ValidationError

from backend.app.ai.config.settings import AISettings



def test_production_rejects_debug():
    with pytest.raises(ValidationError):
        AISettings(environment="production", debug=True)