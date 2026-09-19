"""Paper search: source parsing, query building, merging and de-duplication."""

import httpx
import pytest
import respx

from app.core.config import settings
from app.services.search import SearchUnavailable, search_papers
from app.services.search.merge import deduplicate, interleave
from app.services.search.records import arxiv_id_from, normalize_doi, normalize_title
from app.services.search.sources import arxiv_query, rebuild_abstract

S2 = "https://api.semanticscholar.org/graph/v1/paper/search"
ARXIV = "https://export.arxiv.org/api/query"
OPENALEX = "https://api.openalex.org/works"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
ABSTRACT = "We study attention-based models on graphs and report consistent gains."

S2_BODY = {
    "data": [
        {
            "paperId": "s2-1",
            "title": "Graph Transformers for Molecules",
            "abstract": ABSTRACT,
            "year": 2023,
            "url": "https://www.semanticscholar.org/paper/s2-1",
            "authors": [{"name": "Ada Lovelace"}],
            "externalIds": {"DOI": "10.1000/GT.2023", "ArXiv": "2301.00001"},
            "openAccessPdf": None,
        }
    ]
}
ARXIV_BODY = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2301.00001v2</id>
    <published>2023-01-01T00:00:00Z</published>
    <title>Graph   Transformers for
      Molecules</title>
    <summary>{ABSTRACT}</summary>
    <author><name>Ada Lovelace</name></author>
    <link title="pdf" href="http://arxiv.org/pdf/2301.00001v2" rel="related"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2302.00002v1</id>
    <published>2022-05-01T00:00:00Z</published>
    <title>Message Passing Revisited</title>
    <summary>{ABSTRACT}</summary>
    <author><name>Grace Hopper</name></author>
  </entry>
</feed>"""
OPENALEX_BODY = {
    "results": [
        {
            "id": "https://openalex.org/W1",
            "doi": "https://doi.org/10.2000/pe",
            "display_name": "Positional Encodings for Graphs",
            "publication_year": 2022,
            "authorships": [{"author": {"display_name": "Katherine Johnson"}}],
            "abstract_inverted_index": {
                "Positional": [0],
                "encodings": [1],
                "help": [2],
                "graph": [3],
                "transformers": [4],
                "a": [5],
                "lot.": [6],
                "We": [7],
                "show": [8],
                "why.": [9],
            },
            "best_oa_location": {"pdf_url": "https://example.org/pe.pdf"},
            "primary_location": {"landing_page_url": "https://example.org/pe"},
        }
    ]
}
EPMC_BODY = {
    "resultList": {
        "result": [
            {
                "id": "12345",
                "source": "MED",
                "title": "Graph learning in <i>drug</i> discovery.",
                "authorString": "Hopper G, Turing A.",
                "pubYear": "2021",
                "abstractText": (
                    "<h4>Background</h4>Graph neural networks &amp; drugs are studied in depth here."
                ),
                "doi": "10.3000/DD",
                "fullTextUrlList": {
                    "fullTextUrl": [
                        {
                            "availabilityCode": "S",
                            "documentStyle": "pdf",
                            "url": "https://paywall.example/x.pdf",
                        },
                        {
                            "availabilityCode": "OA",
                            "documentStyle": "pdf",
                            "url": "https://europepmc.org/x.pdf",
                        },
                    ]
                },
            }
        ]
    }
}
UNPAYWALL_OK = {"best_oa_location": {"url_for_pdf": "https://oa.example/gt.pdf"}}


@pytest.fixture
def all_sources():
    with respx.mock(assert_all_called=False) as mock:
        mock.get(S2).mock(return_value=httpx.Response(200, json=S2_BODY))
        mock.get(ARXIV).mock(return_value=httpx.Response(200, text=ARXIV_BODY))
        mock.get(OPENALEX).mock(return_value=httpx.Response(200, json=OPENALEX_BODY))
        mock.get(EPMC).mock(return_value=httpx.Response(200, json=EPMC_BODY))
        mock.get(url__startswith="https://api.unpaywall.org/v2/").mock(
            return_value=httpx.Response(200, json=UNPAYWALL_OK)
        )
        yield mock


async def test_merges_all_sources_and_removes_duplicates(all_sources, monkeypatch):
    monkeypatch.setattr(settings, "CONTACT_EMAIL", "ops@example.org")
    papers = await search_papers(["graph transformers"], limit=20)

    titles = [p["title"] for p in papers]
    # S2 and arXiv both return "Graph Transformers for Molecules": kept once.
    assert titles.count("Graph Transformers for Molecules") == 1
    assert set(titles) == {
        "Graph Transformers for Molecules",
        "Message Passing Revisited",
        "Positional Encodings for Graphs",
        "Graph learning in drug discovery.",
    }
    gt = next(p for p in papers if p["title"] == "Graph Transformers for Molecules")
    assert gt["doi"] == "10.1000/gt.2023"
    assert gt["arxiv_id"] == "2301.00001"
    # S2 had no PDF; the arXiv duplicate's PDF link is kept.
    assert gt["pdf_url"] == "http://arxiv.org/pdf/2301.00001v2"


async def test_source_parsing_details(all_sources):
    papers = {p["source"]: p for p in await search_papers(["x"], limit=20)}
    assert papers["openalex"]["abstract"].startswith("Positional encodings help graph")
    assert papers["openalex"]["pdf_url"] == "https://example.org/pe.pdf"
    epmc = papers["europepmc"]
    assert epmc["abstract"] == "Background Graph neural networks & drugs are studied in depth here."
    assert epmc["pdf_url"] == "https://europepmc.org/x.pdf"  # the open-access copy
    assert epmc["authors"] == ["Hopper G", "Turing A"]


async def test_unpaywall_fills_missing_pdf_links(monkeypatch):
    monkeypatch.setattr(settings, "CONTACT_EMAIL", "ops@example.org")
    with respx.mock(assert_all_called=False) as mock:
        mock.get(S2).mock(return_value=httpx.Response(200, json=S2_BODY))
        unpaywall = mock.get("https://api.unpaywall.org/v2/10.1000/gt.2023").mock(
            return_value=httpx.Response(200, json=UNPAYWALL_OK)
        )
        papers = await search_papers(["x"], limit=5, sources=["semantic_scholar"])
    assert unpaywall.called
    assert papers[0]["pdf_url"] == "https://oa.example/gt.pdf"


async def test_unpaywall_is_skipped_without_a_contact_email(monkeypatch):
    monkeypatch.setattr(settings, "CONTACT_EMAIL", "")
    with respx.mock(assert_all_called=False) as mock:
        mock.get(S2).mock(return_value=httpx.Response(200, json=S2_BODY))
        unpaywall = mock.get(url__startswith="https://api.unpaywall.org/")
        await search_papers(["x"], limit=5, sources=["semantic_scholar"])
    assert not unpaywall.called


async def test_one_failing_source_is_tolerated_but_all_failing_is_an_error():
    with respx.mock(assert_all_called=False) as mock:
        mock.get(S2).mock(return_value=httpx.Response(400))
        mock.get(ARXIV).mock(return_value=httpx.Response(200, text=ARXIV_BODY))
        papers = await search_papers(["x"], limit=5, sources=["semantic_scholar", "arxiv"])
        assert len(papers) == 2

        mock.get(ARXIV).mock(return_value=httpx.Response(404))
        with pytest.raises(SearchUnavailable):  # a new query: not answered from the cache
            await search_papers(["y"], limit=5, sources=["semantic_scholar", "arxiv"])


async def test_year_filters_and_api_keys_are_sent(monkeypatch):
    monkeypatch.setattr(settings, "SEMANTIC_SCHOLAR_API_KEY", "s2-key")
    with respx.mock(assert_all_called=False) as mock:
        s2 = mock.get(S2).mock(return_value=httpx.Response(200, json={"data": []}))
        oa = mock.get(OPENALEX).mock(return_value=httpx.Response(200, json={"results": []}))
        await search_papers(
            ["x"], limit=5, year_from=2020, year_to=2024, sources=["semantic_scholar", "openalex"]
        )
    s2_request = s2.calls[0].request
    assert s2_request.url.params["year"] == "2020-2024"
    assert s2_request.headers["x-api-key"] == "s2-key"
    assert "from_publication_date:2020-01-01" in oa.calls[0].request.url.params["filter"]


def test_arxiv_query_ands_the_terms():
    assert arxiv_query("graph neural networks") == "all:graph AND all:neural AND all:networks"
    assert arxiv_query("gnn", 2020, 2021) == (
        "all:gnn AND submittedDate:[202001010000 TO 202112312359]"
    )


def test_identifier_helpers():
    assert normalize_doi("https://doi.org/10.1000/ABC.") == "10.1000/abc"
    assert normalize_doi("no doi here") is None
    assert arxiv_id_from("http://arxiv.org/abs/2301.00001v3") == "2301.00001"
    assert arxiv_id_from("10.48550/arXiv.2301.00001") == "2301.00001"
    assert arxiv_id_from("https://example.org/paper") is None
    assert normalize_title("Graph  Transformers: A Survey!") == "graph transformers a survey"
    assert rebuild_abstract({"b": [1], "a": [0], "c": [2]}) == "a b c"


def test_dedup_matches_near_identical_titles_and_interleave_takes_turns():
    a = {"title": "Graph Transformers for Molecules", "abstract": ABSTRACT, "source": "x"}
    b = {
        "title": "Graph transformers for molecules.",
        "abstract": ABSTRACT + " More.",
        "source": "y",
        "doi": "10.1/x",
    }
    c = {"title": "Something else entirely", "abstract": ABSTRACT, "source": "y"}
    merged = deduplicate([a, b, c])
    assert len(merged) == 2
    assert merged[0]["doi"] == "10.1/x" and merged[0]["abstract"].endswith("More.")
    assert deduplicate([{"title": "No abstract", "abstract": "", "source": "x"}]) == []
    assert [r["n"] for r in interleave([[{"n": 1}, {"n": 3}], [{"n": 2}]])] == [1, 2, 3]


async def test_repeated_searches_are_served_from_the_cache(monkeypatch):
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import update

    from app.db.session import AsyncSessionLocal
    from app.models.models import SearchCache

    with respx.mock(assert_all_called=False) as mock:
        s2 = mock.get(S2).mock(return_value=httpx.Response(200, json=S2_BODY))
        first = await search_papers(["Graph  Transformers"], limit=5, sources=["semantic_scholar"])
        # Same request (case and spacing don't matter): no second call.
        second = await search_papers(["graph transformers"], limit=5, sources=["semantic_scholar"])
        assert s2.call_count == 1
        assert [p["title"] for p in first] == [p["title"] for p in second]

        # Different filters are a different request.
        await search_papers(
            ["graph transformers"], limit=5, year_from=2020, sources=["semantic_scholar"]
        )
        assert s2.call_count == 2

        # Expired entries are fetched again.
        async with AsyncSessionLocal() as db:
            old = datetime.now(timezone.utc) - timedelta(days=30)
            await db.execute(update(SearchCache).values(created_at=old))
            await db.commit()
        await search_papers(["graph transformers"], limit=5, sources=["semantic_scholar"])
        assert s2.call_count == 3


async def test_cache_can_be_disabled(monkeypatch):
    monkeypatch.setattr(settings, "SEARCH_CACHE_DAYS", 0)
    with respx.mock(assert_all_called=False) as mock:
        s2 = mock.get(S2).mock(return_value=httpx.Response(200, json=S2_BODY))
        await search_papers(["x"], limit=5, sources=["semantic_scholar"])
        await search_papers(["x"], limit=5, sources=["semantic_scholar"])
    assert s2.call_count == 2
