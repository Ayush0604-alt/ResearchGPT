from app.api.routes import chat as chat_route
from app.utils.gemini_client import RateLimitError


async def _ask(client, user, pid, question="What models are used?"):
    return await client.post(
        "/chat/query", json={"project_id": pid, "question": question}, headers=user["headers"]
    )


async def test_chat_returns_answer_and_citations_key(client, make_user, make_project, monkeypatch):
    async def fake_ask(prompt, max_tokens):
        return "They use transformers."

    monkeypatch.setattr(chat_route, "ask_gemini", fake_ask)
    user = await make_user()
    pid = await make_project(user)

    body = (await _ask(client, user, pid)).json()

    assert body == {"answer": "They use transformers.", "citations": []}
    history = (await client.get(f"/chat/history/{pid}", headers=user["headers"])).json()
    assert [m["role"] for m in history["messages"]] == ["user", "assistant"]


async def test_chat_hides_internal_errors(client, make_user, make_project, monkeypatch):
    async def boom(prompt, max_tokens):
        raise RuntimeError("connection to 10.0.0.5 failed, key=AIza-secret")

    monkeypatch.setattr(chat_route, "ask_gemini", boom)
    user = await make_user()
    pid = await make_project(user)

    resp = await _ask(client, user, pid)

    assert resp.status_code == 502
    assert "10.0.0.5" not in resp.text and "AIza" not in resp.text
    assert "try again" in resp.json()["detail"]
    # A failed exchange is not stored.
    history = (await client.get(f"/chat/history/{pid}", headers=user["headers"])).json()
    assert history["total"] == 0


async def test_chat_explains_rate_limits(client, make_user, make_project, monkeypatch):
    async def limited(prompt, max_tokens):
        raise RateLimitError("429")

    monkeypatch.setattr(chat_route, "ask_gemini", limited)
    user = await make_user()
    pid = await make_project(user)

    resp = await _ask(client, user, pid)

    assert resp.status_code == 429
    assert "rate limit" in resp.json()["detail"]
