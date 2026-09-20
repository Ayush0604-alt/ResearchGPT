"""Quality metrics for comparing prompt versions, and run metadata storage."""

from app.db.session import AsyncSessionLocal
from app.models.models import PaperSummary
from app.services.review_metrics import compare, load_rows, review_metrics

from .test_analysis import REVIEW, _collected_project

RUN = {
    "prompt_version": "2026-09-a",
    "provider": "gemini",
    "models": {"extract": "gemini-2.5-flash", "review": "gemini-2.5-pro"},
    "usage": {
        "gemini-2.5-flash": {"calls": 4, "input_tokens": 9000, "output_tokens": 1000},
        "gemini-2.5-pro": {"calls": 1, "input_tokens": 4000, "output_tokens": 2000},
    },
    "duration_ms": 42000,
    "papers": 2,
    "failed_papers": 0,
    "removed_citations": 1,
}


def test_review_metrics():
    review = {
        "introduction": "## Scope\n\nGraph transformers help a lot [P1]. Nobody cites this sentence.",
        "body": "- Message passing is cheaper per layer [P2].",
        "comparison": "| Paper | Model |\n|---|---|\n| [P3] | GraphGPS |",
        "conclusion": "",
        "citation_checks": [
            {"verdict": "supported"},
            {"verdict": "supported"},
            {"verdict": "partly"},
            {"verdict": "unsupported"},
        ],
    }
    m = review_metrics(review, papers_available=4, run_meta=RUN)
    assert m == {
        "sections_filled": 3,
        "words": 16,
        "citation_density": 0.667,  # 2 of 3 sentences; the heading is not a sentence
        "coverage": 0.75,  # P1, P2 and P3 (from the table) of 4
        "supported_rate": 0.5,
        "unsupported_rate": 0.25,
        "removed_citations": 1,
        "tokens": 16000,
    }


def test_metrics_without_checks_or_run_meta_are_missing_not_zero():
    m = review_metrics({"introduction": "Short."}, papers_available=0)
    assert m["supported_rate"] is None
    assert m["coverage"] is None
    assert m["tokens"] is None
    assert m["removed_citations"] is None


def test_compare_averages_per_group_ignoring_missing():
    rows = [
        ("v1", {"words": 100, "supported_rate": 0.5}),
        ("v1", {"words": 200, "supported_rate": None}),
        ("v2", {"words": 300, "supported_rate": 0.9}),
    ]
    assert compare(rows) == {
        "v1": {"reviews": 2, "words": 150, "supported_rate": 0.5},
        "v2": {"reviews": 1, "words": 300, "supported_rate": 0.9},
    }


async def test_run_meta_is_stored_and_feeds_the_evaluation(client, make_user, make_project):
    user, pid, paper_ids = await _collected_project(make_user, make_project)
    async with AsyncSessionLocal() as db:
        db.add(PaperSummary(paper_id=paper_ids[0], summary="s"))
        await db.commit()
    h = user["headers"]
    resp = await client.put(f"/projects/{pid}/analysis", json=REVIEW | {"run": RUN}, headers=h)
    assert resp.status_code == 200, resp.text
    review = (await client.get(f"/reviews/{pid}", headers=h)).json()
    assert review["run_meta"]["usage"]["gemini-2.5-pro"]["output_tokens"] == 2000

    async with AsyncSessionLocal() as db:
        rows = [r for r in await load_rows(db) if r["project_id"] == pid]
        topic = rows[0]["topic"]
        assert await load_rows(db, {"some other topic"}) == []
        assert [r["project_id"] for r in await load_rows(db, {topic.lower()})] == [pid]
    assert rows[0]["prompt_version"] == "2026-09-a"
    assert rows[0]["metrics"]["coverage"] == 1.0  # cites P1; one paper analysed
    assert rows[0]["metrics"]["tokens"] == 16000


async def test_run_meta_is_validated(client, make_user, make_project):
    user, pid, _ = await _collected_project(make_user, make_project)
    bad = RUN | {"duration_ms": -1}
    resp = await client.put(
        f"/projects/{pid}/analysis", json=REVIEW | {"run": bad}, headers=user["headers"]
    )
    assert resp.status_code == 422


async def test_each_saved_review_is_kept_as_a_version(client, make_user, make_project):
    from app.services.analysis_service import MAX_VERSIONS

    user, pid, _ = await _collected_project(make_user, make_project)
    h = user["headers"]

    for i in range(MAX_VERSIONS + 2):
        body = REVIEW | {"introduction": f"Version {i} [P1].", "run": RUN}
        assert (await client.put(f"/projects/{pid}/analysis", json=body, headers=h)).status_code
    versions = (await client.get(f"/reviews/{pid}/versions", headers=h)).json()

    assert len(versions) == MAX_VERSIONS  # the oldest are dropped
    assert versions[0]["current"] is True
    assert versions[0]["sections"]["introduction"] == f"Version {MAX_VERSIONS + 1} [P1]."
    assert versions[-1]["sections"]["introduction"] == "Version 2 [P1]."
    assert versions[0]["papers"] == ["Paper 0", "Paper 1"]
    assert versions[0]["run_meta"]["prompt_version"] == RUN["prompt_version"]
    assert versions[0]["metrics"]["words"] > 0

    # The current review still reads as it always did.
    review = (await client.get(f"/reviews/{pid}", headers=h)).json()
    assert review["introduction"] == f"Version {MAX_VERSIONS + 1} [P1]."


async def test_versions_are_private(client, make_user, make_project):
    user, pid, _ = await _collected_project(make_user, make_project)
    await client.put(f"/projects/{pid}/analysis", json=REVIEW, headers=user["headers"])
    other = await make_user()
    assert (
        await client.get(f"/reviews/{pid}/versions", headers=other["headers"])
    ).status_code == 404
