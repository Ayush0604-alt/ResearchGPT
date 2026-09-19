"""SSRF guard, bounded downloads and PDF text extraction."""

import httpx
import pytest
import respx

from app.utils import safe_http
from app.utils.pdf_text import extract_pdf_text, looks_like_pdf
from app.utils.safe_http import (
    DownloadTooLargeError,
    UnsafeURLError,
    check_public_url,
    fetch_public,
)
from tests.pdf_fixture import make_pdf

PUBLIC_IP = "93.184.216.34"


@pytest.fixture
def dns(monkeypatch):
    """Fake DNS: map hostnames to addresses; unknown hosts resolve to a public IP."""
    table: dict[str, list[str]] = {}

    async def resolve(host, port):
        return table.get(host, [PUBLIC_IP])

    monkeypatch.setattr(safe_http, "_resolve", resolve)
    return table


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.org/paper.pdf",
        "gopher://example.org/",
        "http:///no-host",
    ],
)
async def test_rejects_non_http_urls(dns, url):
    with pytest.raises(UnsafeURLError):
        await check_public_url(url)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.9",
        "192.168.1.1",
        "169.254.169.254",  # cloud metadata endpoint
        "0.0.0.0",
        "::1",
        "fd00::1",
        "fe80::1%eth0",
    ],
)
async def test_rejects_hosts_that_resolve_to_private_addresses(dns, address):
    dns["evil.example"] = [PUBLIC_IP, address]  # one bad address is enough
    with pytest.raises(UnsafeURLError):
        await check_public_url("https://evil.example/paper.pdf")


async def test_rejects_literal_private_ip_urls(monkeypatch):
    # No DNS patch: a literal IP resolves to itself.
    with pytest.raises(UnsafeURLError):
        await check_public_url("http://127.0.0.1:8000/admin")


async def test_accepts_public_hosts(dns):
    await check_public_url("https://arxiv.org/pdf/1234.5678")


@respx.mock
async def test_fetch_follows_safe_redirects(dns):
    respx.get("https://a.example/p").mock(
        return_value=httpx.Response(302, headers={"location": "/final.pdf"})
    )
    respx.get("https://a.example/final.pdf").mock(return_value=httpx.Response(200, content=b"PDF"))
    async with httpx.AsyncClient() as client:
        body, final = await fetch_public(client, "https://a.example/p", max_bytes=100)
    assert (body, final) == (b"PDF", "https://a.example/final.pdf")


@respx.mock
async def test_fetch_blocks_redirects_to_internal_addresses(dns):
    dns["internal.example"] = ["10.0.0.5"]
    respx.get("https://a.example/p").mock(
        return_value=httpx.Response(302, headers={"location": "http://internal.example/secret"})
    )
    internal = respx.get("http://internal.example/secret")
    async with httpx.AsyncClient() as client:
        with pytest.raises(UnsafeURLError):
            await fetch_public(client, "https://a.example/p", max_bytes=100)
    assert not internal.called


@respx.mock
async def test_fetch_limits_redirect_chains(dns):
    respx.get(url__regex=r"https://loop\.example/.*").mock(
        return_value=httpx.Response(302, headers={"location": "/again"})
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(UnsafeURLError, match="redirects"):
            await fetch_public(client, "https://loop.example/start", max_bytes=100)


@respx.mock
async def test_fetch_enforces_size_limit(dns):
    respx.get("https://big.example/declared").mock(
        return_value=httpx.Response(200, headers={"content-length": "999999"}, content=b"x")
    )
    respx.get("https://big.example/streamed").mock(
        return_value=httpx.Response(200, content=b"x" * 5000)
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(DownloadTooLargeError):
            await fetch_public(client, "https://big.example/declared", max_bytes=1000)
        with pytest.raises(DownloadTooLargeError):
            await fetch_public(client, "https://big.example/streamed", max_bytes=1000)


async def test_extracts_text_from_a_real_pdf():
    lines = [f"Line {i}: transformers improve graph learning benchmarks." for i in range(8)]
    pdf = make_pdf(lines)
    assert looks_like_pdf(pdf)
    text = await extract_pdf_text(pdf)
    assert text is not None
    assert "transformers improve graph learning" in text


async def test_rejects_non_pdf_and_nearly_empty_pdfs():
    assert await extract_pdf_text(b"<html>paywall</html>") is None
    assert await extract_pdf_text(make_pdf(["too short"])) is None
    assert await extract_pdf_text(b"%PDF-1.4 garbage that is not a pdf") is None
