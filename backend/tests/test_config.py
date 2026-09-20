import pytest
from pydantic import ValidationError

from app.core.config import Settings

STRONG = "a" * 64


def _settings(**kwargs):
    # Production-like defaults; tests override one thing at a time.
    return Settings(_env_file=None, **({"COOKIE_SECURE": True} | kwargs))


@pytest.mark.parametrize(
    "secret",
    ["", "short", "dev_secret_key_change_in_production_min_32_chars", "changeme"],
)
def test_production_refuses_weak_secret(secret):
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        _settings(APP_ENV="production", SECRET_KEY=secret)


def test_production_accepts_strong_secret():
    assert _settings(APP_ENV="production", SECRET_KEY=STRONG).SECRET_KEY == STRONG


def test_development_allows_default_secret():
    assert _settings(APP_ENV="development").SECRET_KEY


def test_debug_and_sql_echo_default_off():
    s = _settings()
    assert s.DEBUG is False
    assert s.SQL_ECHO is False


@pytest.mark.parametrize("var", ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"])
def test_production_refuses_server_llm_keys(monkeypatch, var):
    monkeypatch.setenv(var, "sk-something")
    with pytest.raises(ValidationError, match=var):
        _settings(APP_ENV="production", SECRET_KEY=STRONG)


def test_development_tolerates_a_leftover_llm_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "AIza-old")
    assert _settings(APP_ENV="development").APP_ENV == "development"


def test_production_requires_secure_cookies():
    with pytest.raises(ValidationError, match="COOKIE_SECURE"):
        _settings(APP_ENV="production", SECRET_KEY=STRONG, COOKIE_SECURE=False)


@pytest.mark.parametrize(
    "raw,expected",
    [
        # How a hosting dashboard's env var actually gets typed.
        ('["https://a.onrender.com"]', ["https://a.onrender.com"]),
        (
            '["https://a.onrender.com", "https://b.com"]',
            ["https://a.onrender.com", "https://b.com"],
        ),
        ("https://a.onrender.com", ["https://a.onrender.com"]),
        ("https://a.onrender.com,https://b.com", ["https://a.onrender.com", "https://b.com"]),
        ("  https://a.onrender.com , https://b.com  ", ["https://a.onrender.com", "https://b.com"]),
        ("[https://a.onrender.com]", ["https://a.onrender.com"]),
        ("['https://a.onrender.com']", ["https://a.onrender.com"]),
        ("", []),
    ],
)
def test_cors_origins_accepts_any_reasonable_spelling(monkeypatch, raw, expected):
    """A bare origin or a comma-separated list must not abort start-up.

    pydantic-settings JSON-decodes a List[str] inside the settings source,
    before any model validator runs, so anything but strict JSON used to raise
    SettingsError and stop the app from booting at all.
    """
    monkeypatch.setenv("CORS_ORIGINS", raw)
    assert Settings(_env_file=None).CORS_ORIGINS == expected
