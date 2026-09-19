"""Storing results the browser computed: per-paper extractions and the review."""

import pytest
from sqlalchemy import func, select

from app.db.session import AsyncSessionLocal
from app.models.models import Paper, PaperFindings, PaperSummary, ResearchProject

EXTRACTION = {
    "summary": "Graph transformers beat GNN baselines.",
    "methodology": "Benchmarks on OGB.",
    "conclusion": "Attention helps.",
    "model_used": "GraphGPS",
    "dataset_used": "ogbg-molhiv",
    "metrics": "ROC-AUC 0.79",
    "contributions": "A new positional encoding.",
    "limitations": "Quadratic memory.",
    "key_quotes": ["we observe consistent gains"],
    "model": "gemini-2.5-flash",
}
REVIEW = {
    "introduction": "Intro [P1].",
    "body": "Body.",
    "discussion": "Discussion.",
    "conclusion": "Conclusion.",
    "trends": "Trends.",
    "gaps": "Gaps.",
    "comparison": "| Paper | Model |\n|---|---|\n| [P1] | GraphGPS |",
    "model": "gemini-2.5-pro",
}


async def _collected_project(make_user, make_project, *, status="collected", n_papers=2):
    user = await make_user()
    pid = await make_project(user)
    async with AsyncSessionLocal() as db:
        project = await db.get(ResearchProject, pid)
        project.status = status
        for i in range(n_papers):
            db.add(
                Paper(
                    project_id=pid,
                    title=f"Paper {i}",
                    abstract="Abstract",
                    full_text="Full text" if i == 0 else None,
                )
            )
        await db.commit()
        paper_ids = (await db.scalars(select(Paper.id).where(Paper.project_id == pid))).all()
    return user, pid, sorted(paper_ids)


async def test_texts_include_full_text_and_extraction_state(client, make_user, make_project):
    user, pid, (first, second) = await _collected_project(make_user, make_project)
    h = user["headers"]
    await client.put(f"/projects/{pid}/papers/{first}/extraction", json=EXTRACTION, headers=h)

    texts = (await client.get(f"/papers/{pid}/texts", headers=h)).json()

    assert [t["id"] for t in texts] == [first, second]
    assert texts[0]["full_text"] == "Full text" and texts[1]["full_text"] is None
    assert [t["has_extraction"] for t in texts] == [True, False]


async def test_extraction_upserts_summary_and_findings(client, make_user, make_project):
    user, pid, (first, _) = await _collected_project(make_user, make_project)
    h = user["headers"]
    url = f"/projects/{pid}/papers/{first}/extraction"

    assert (await client.put(url, json=EXTRACTION, headers=h)).status_code == 204
    assert (
        await client.put(url, json=EXTRACTION | {"summary": "v2"}, headers=h)
    ).status_code == 204

    async with AsyncSessionLocal() as db:
        n = await db.scalar(select(func.count()).select_from(PaperSummary))
        m = await db.scalar(select(func.count()).select_from(PaperFindings))
    assert (n, m) == (1, 1)
    summaries = (await client.get(f"/papers/{pid}/summaries", headers=h)).json()
    findings = (await client.get(f"/papers/{pid}/findings", headers=h)).json()
    assert summaries[0]["summary"] == "v2"
    assert findings[0]["dataset_used"] == "ogbg-molhiv"
    assert findings[0]["raw_json"]["key_quotes"] == ["we observe consistent gains"]


async def test_extraction_rejects_papers_from_other_projects(client, make_user, make_project):
    user, pid, _ = await _collected_project(make_user, make_project)
    _, _, (foreign_paper, _) = await _collected_project(make_user, make_project)

    resp = await client.put(
        f"/projects/{pid}/papers/{foreign_paper}/extraction",
        json=EXTRACTION,
        headers=user["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.parametrize("status", ["pending", "collecting", "failed"])
async def test_results_need_collected_papers(client, make_user, make_project, status):
    user, pid, (first, _) = await _collected_project(make_user, make_project, status=status)
    h = user["headers"]
    extraction = await client.put(
        f"/projects/{pid}/papers/{first}/extraction", json=EXTRACTION, headers=h
    )
    analysis = await client.put(f"/projects/{pid}/analysis", json=REVIEW, headers=h)
    assert (extraction.status_code, analysis.status_code) == (409, 409)


async def test_saving_the_analysis_completes_the_project(client, make_user, make_project):
    user, pid, _ = await _collected_project(make_user, make_project)
    h = user["headers"]

    resp = await client.put(f"/projects/{pid}/analysis", json=REVIEW, headers=h)

    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"
    review = (await client.get(f"/reviews/{pid}", headers=h)).json()
    assert review["comparison"].startswith("| Paper")
    markdown = (await client.get(f"/reviews/{pid}/markdown", headers=h)).text
    assert "## Comparison" in markdown and "Intro [P1]." in markdown

    # Saving again (a re-run) updates the same review.
    await client.put(f"/projects/{pid}/analysis", json=REVIEW | {"body": "v2"}, headers=h)
    assert (await client.get(f"/reviews/{pid}", headers=h)).json()["body"] == "v2"


@pytest.mark.parametrize(
    "path_suffix,payload",
    [
        ("analysis", REVIEW | {"body": "x" * 60_001}),
        ("analysis", {k: v for k, v in REVIEW.items() if k != "introduction"}),
        ("extraction", EXTRACTION | {"key_quotes": ["q"] * 11}),
        ("extraction", EXTRACTION | {"summary": "x" * 20_001}),
    ],
)
async def test_result_payloads_are_bounded(client, make_user, make_project, path_suffix, payload):
    user, pid, (first, _) = await _collected_project(make_user, make_project)
    path = (
        f"/projects/{pid}/analysis"
        if path_suffix == "analysis"
        else f"/projects/{pid}/papers/{first}/extraction"
    )
    resp = await client.put(path, json=payload, headers=user["headers"])
    assert resp.status_code == 422


async def test_pdf_is_proxied_for_the_browser(client, make_user, make_project, monkeypatch):
    from app.services import collection_service

    fetched = []

    async def fetch_pdf(url):
        fetched.append(url)
        return b"%PDF-1.4 fake pdf" if url.endswith("ok.pdf") else None

    monkeypatch.setattr(collection_service, "default_fetch_pdf", fetch_pdf)
    user, pid, (with_pdf, without_pdf) = await _collected_project(make_user, make_project)
    async with AsyncSessionLocal() as db:
        paper = await db.get(Paper, with_pdf)
        paper.pdf_url = "https://example.org/ok.pdf"
        await db.commit()
    h = user["headers"]

    ok = await client.get(f"/papers/{pid}/{with_pdf}/pdf", headers=h)
    assert ok.status_code == 200
    assert ok.headers["content-type"] == "application/pdf"
    assert ok.headers["cache-control"] == "no-store"
    assert ok.content.startswith(b"%PDF")
    assert (await client.get(f"/papers/{pid}/{without_pdf}/pdf", headers=h)).status_code == 404

    texts = (await client.get(f"/papers/{pid}/texts", headers=h)).json()
    assert [t["has_pdf"] for t in texts] == [True, False]

    # Another user can't use the proxy for someone else's paper.
    other = await make_user()
    assert (
        await client.get(f"/papers/{pid}/{with_pdf}/pdf", headers=other["headers"])
    ).status_code == 404
    assert fetched == ["https://example.org/ok.pdf"]


async def test_citation_checks_are_stored_with_the_review(client, make_user, make_project):
    user, pid, _ = await _collected_project(make_user, make_project)
    checks = [
        {"claim": "Transformers win [P1].", "paper_ids": [1], "verdict": "supported", "note": ""},
        {
            "claim": "It is free [P1].",
            "paper_ids": [1],
            "verdict": "unsupported",
            "note": "Not stated",
        },
    ]
    h = user["headers"]
    await client.put(
        f"/projects/{pid}/analysis", json=REVIEW | {"citation_checks": checks}, headers=h
    )
    review = (await client.get(f"/reviews/{pid}", headers=h)).json()
    assert [c["verdict"] for c in review["citation_checks"]] == ["supported", "unsupported"]

    bad = checks[:1] + [checks[1] | {"verdict": "maybe"}]
    resp = await client.put(
        f"/projects/{pid}/analysis", json=REVIEW | {"citation_checks": bad}, headers=h
    )
    assert resp.status_code == 422
