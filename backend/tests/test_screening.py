"""Search candidates for screening, and collecting only the screened papers."""

import pytest

from app.services import collection_service
from app.services.search import SearchUnavailable

ABSTRACT = "A long enough abstract about graph learning and its benchmarks."


def record(n, **extra):
    return {
        "title": f"Paper {n}",
        "authors": [f"Author {n}"],
        "abstract": ABSTRACT,
        "year": 2020 + n,
        "url": f"https://example.org/{n}",
        "pdf_url": f"https://example.org/{n}.pdf" if n % 2 else None,
        "doi": f"10.1000/{n}",
        "source": "openalex",
        "external_id": str(n),
        **extra,
    }


@pytest.fixture
def fake_search(monkeypatch):
    calls = []

    async def candidates(queries, limit, year_from=None, year_to=None, sources=None):
        calls.append(
            {"queries": queries, "year_from": year_from, "year_to": year_to, "sources": sources}
        )
        return [record(n) for n in range(1, 6)]

    async def fetch_text(client, url):
        return f"Full text of {url} " * 20

    monkeypatch.setattr(collection_service, "default_candidates", candidates)
    monkeypatch.setattr(collection_service, "default_fetch_text", fetch_text)
    return calls


async def _project(client, user, **filters):
    resp = await client.post(
        "/projects", json={"topic": "graph learning", **filters}, headers=user["headers"]
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_search_returns_candidates_using_the_project_filters(client, make_user, fake_search):
    user = await make_user()
    project = await _project(client, user, year_from=2021, year_to=2024, sources=["arxiv"])
    assert (project["year_from"], project["year_to"], project["sources"]) == (2021, 2024, ["arxiv"])

    resp = await client.post(
        f"/projects/{project['id']}/search",
        json={"queries": ["graph neural networks", "graph learning"]},
        headers=user["headers"],
    )

    assert resp.status_code == 200
    candidates = resp.json()["candidates"]
    assert [c["id"] for c in candidates] == [0, 1, 2, 3, 4]
    assert candidates[0]["has_pdf"] is True and candidates[1]["has_pdf"] is False
    # The topic always comes first, and repeats are dropped.
    assert fake_search[0]["queries"] == ["graph learning", "graph neural networks"]
    assert fake_search[0]["year_from"] == 2021 and fake_search[0]["sources"] == ["arxiv"]


async def test_collect_reads_only_the_screened_candidates(client, make_user, fake_search):
    user = await make_user()
    pid = (await _project(client, user))["id"]
    h = user["headers"]
    await client.post(f"/projects/{pid}/search", json={"queries": []}, headers=h)

    resp = await client.post(
        f"/projects/{pid}/collect",
        json={
            "candidate_ids": [2, 0],
            "relevance": [
                {"id": 2, "score": 9, "reason": "Directly on topic"},
                {"id": 0, "score": 6},
            ],
        },
        headers=h,
    )

    assert resp.status_code == 202
    assert (await client.get(f"/projects/{pid}", headers=h)).json()["status"] == "collected"
    papers = {p["title"]: p for p in (await client.get(f"/papers/{pid}", headers=h)).json()}
    assert set(papers) == {"Paper 1", "Paper 3"}
    assert papers["Paper 3"]["relevance_score"] == 9
    assert papers["Paper 3"]["relevance_reason"] == "Directly on topic"
    assert papers["Paper 1"]["has_full_text"] is True


async def test_collect_rejects_unknown_candidates(client, make_user, fake_search):
    user = await make_user()
    pid = (await _project(client, user))["id"]
    h = user["headers"]

    before_search = await client.post(
        f"/projects/{pid}/collect", json={"candidate_ids": [0]}, headers=h
    )
    assert before_search.status_code == 409

    await client.post(f"/projects/{pid}/search", json={}, headers=h)
    unknown = await client.post(f"/projects/{pid}/collect", json={"candidate_ids": [99]}, headers=h)
    assert unknown.status_code == 409


async def test_search_reports_unavailable_sources(client, make_user, monkeypatch):
    async def down(*args, **kwargs):
        raise SearchUnavailable("all failed")

    monkeypatch.setattr(collection_service, "default_candidates", down)
    user = await make_user()
    pid = (await _project(client, user))["id"]

    resp = await client.post(f"/projects/{pid}/search", json={}, headers=user["headers"])

    assert resp.status_code == 503
    assert "couldn't be reached" in resp.json()["detail"]


@pytest.mark.parametrize(
    "filters",
    [
        {"year_from": 2024, "year_to": 2020},
        {"year_from": 1500},
        {"sources": ["google_scholar"]},
        {"sources": []},
    ],
)
async def test_project_filters_are_validated(client, make_user, filters):
    user = await make_user()
    resp = await client.post(
        "/projects", json={"topic": "graph learning", **filters}, headers=user["headers"]
    )
    assert resp.status_code == 422


async def test_search_queries_are_bounded(client, make_user, fake_search):
    user = await make_user()
    pid = (await _project(client, user))["id"]
    too_many = await client.post(
        f"/projects/{pid}/search",
        json={"queries": [f"q{i} x" for i in range(6)]},
        headers=user["headers"],
    )
    assert too_many.status_code == 422


async def test_snowball_adds_only_new_citation_neighbours(
    client, make_user, fake_search, monkeypatch
):
    seen = {}

    async def neighbours(dois, limit):
        seen["dois"] = dois
        return [
            record(1),  # already a candidate (same DOI): skipped
            record(7, title="Paper 2", doi=None),  # same title as a candidate: skipped
            record(8, title="Foundational work"),
            record(9, title="Follow-up study"),
        ]

    monkeypatch.setattr(collection_service, "default_neighbours", neighbours)
    user = await make_user()
    project = await _project(client, user, snowball=True)
    assert project["snowball"] is True
    h = user["headers"]
    await client.post(f"/projects/{project['id']}/search", json={}, headers=h)

    resp = await client.post(
        f"/projects/{project['id']}/snowball", json={"seed_ids": [0, 2]}, headers=h
    )

    assert resp.status_code == 200
    added = resp.json()["candidates"]
    assert [(c["id"], c["title"]) for c in added] == [
        (5, "Foundational work"),
        (6, "Follow-up study"),
    ]
    assert seen["dois"] == ["10.1000/1", "10.1000/3"]
    # The new candidates can be collected like any other.
    collect = await client.post(
        f"/projects/{project['id']}/collect", json={"candidate_ids": [0, 6]}, headers=h
    )
    assert collect.status_code == 202


async def test_snowball_without_seed_dois_adds_nothing(client, make_user, monkeypatch):
    async def candidates(queries, limit, **kwargs):
        return [record(1, doi=None)]

    monkeypatch.setattr(collection_service, "default_candidates", candidates)
    user = await make_user()
    pid = (await _project(client, user))["id"]
    await client.post(f"/projects/{pid}/search", json={}, headers=user["headers"])
    resp = await client.post(
        f"/projects/{pid}/snowball", json={"seed_ids": [0]}, headers=user["headers"]
    )
    assert resp.json() == {"candidates": []}
