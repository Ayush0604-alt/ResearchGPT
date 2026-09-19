import pytest
from pydantic import ValidationError

from app.core.config import Settings

STRONG = "a" * 64


def _settings(**kwargs):
    return Settings(_env_file=None, **kwargs)


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
