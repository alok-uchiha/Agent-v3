from datetime import date

from backend.app.ai.prompt.research_prompt import build_researcher_prompt


def test_prompt_contains_the_given_date():
    assert "2026-11-19" in build_researcher_prompt(date(2026, 11, 19))


def test_prompt_has_no_placeholder_left():
    assert "{today}" not in build_researcher_prompt(date(2026, 11, 19))


def test_prompt_has_no_persona_name():
    assert "lulu" not in build_researcher_prompt().lower()