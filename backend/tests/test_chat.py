"""Chat: the browser generates answers; the server stores finished exchanges."""

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.models import Paper


async def _paper(pid, title="Paper A"):
    async with AsyncSessionLocal() as db:
        paper = Paper(project_id=pid, title=title)
        db.add(paper)
        await db.commit()
        return paper.id


async def _save(client, user, pid, **overrides):
    body = {"question": "What models?", "answer": "Transformers [P1].", "citations": []}
    return await client.post(
        f"/chat/{pid}/messages", json=body | overrides, headers=user["headers"]
    )


async def test_saves_question_and_answer_in_order(client, make_user, make_project):
    user = await make_user()
    pid = await make_project(user)

    resp = await _save(client, user, pid)
    await _save(client, user, pid, question="Second?", answer="Second answer.")

    assert resp.status_code == 201
    history = (await client.get(f"/chat/history/{pid}", headers=user["headers"])).json()
    contents = [(m["role"], m["content"]) for m in history["messages"]]
    assert contents == [
        ("user", "What models?"),
        ("assistant", "Transformers [P1]."),
        ("user", "Second?"),
        ("assistant", "Second answer."),
    ]


async def test_keeps_only_citations_of_this_projects_papers(client, make_user, make_project):
    user = await make_user()
    pid = await make_project(user)
    other = await make_project(user)
    mine = await _paper(pid, "Mine")
    foreign = await _paper(other, "Foreign")

    await _save(
        client,
        user,
        pid,
        citations=[
            {"paper_id": mine},
            {"paper_id": foreign},
            {"paper_id": mine},
            {"paper_id": 999},
        ],
    )

    answer = (await client.get(f"/chat/history/{pid}", headers=user["headers"])).json()["messages"][
        1
    ]
    assert answer["citations"] == {"papers": [{"paper_id": mine, "title": "Mine"}]}


async def test_rejects_empty_or_oversized_exchanges(client, make_user, make_project):
    user = await make_user()
    pid = await make_project(user)
    for overrides in ({"question": ""}, {"answer": ""}, {"answer": "x" * 20_001}):
        assert (await _save(client, user, pid, **overrides)).status_code == 422


async def test_server_no_longer_answers_questions(client, make_user, make_project):
    user = await make_user()
    pid = await make_project(user)
    resp = await client.post(
        "/chat/query", json={"project_id": pid, "question": "q"}, headers=user["headers"]
    )
    assert resp.status_code in (404, 405)
    async with AsyncSessionLocal() as db:
        assert (await db.scalars(select(Paper))).all() == []
