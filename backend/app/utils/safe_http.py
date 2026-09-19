"""
Fetching URLs that come from third parties (search APIs) without SSRF.

Every URL, including each redirect target, must be http(s) and resolve only to
public IP addresses. Bodies are streamed with a hard size cap.

Residual risk: httpx resolves the host again when connecting, so a DNS record
that changes between our check and the connection (rebinding) isn't covered.
Run the API without access to sensitive internal services as well.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

USER_AGENT = "ResearchGPT/1.0 (research tool; https://github.com/Ayush0604-alt)"
MAX_REDIRECTS = 3


class UnsafeURLError(ValueError):
    """The URL is not allowed (bad scheme, or it points at a non-public address)."""


class DownloadTooLargeError(ValueError):
    pass


async def _resolve(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [info[4][0] for info in infos]


async def check_public_url(url: str) -> None:
    """Raise UnsafeURLError unless `url` is http(s) and every address it resolves to is public."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeURLError(f"Unsupported URL: {url[:100]}")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        addresses = await _resolve(parsed.hostname, port)
    except OSError as exc:
        raise UnsafeURLError(f"Cannot resolve {parsed.hostname}") from exc
    for addr in addresses:
        ip = ipaddress.ip_address(addr.split("%")[0])  # strip IPv6 zone ids
        if not ip.is_global:
            raise UnsafeURLError(f"{parsed.hostname} resolves to a non-public address")


async def fetch_public(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_bytes: int,
) -> tuple[bytes, str]:
    """GET a public URL, following up to MAX_REDIRECTS checked redirects.

    Returns (body, final_url). Raises UnsafeURLError, DownloadTooLargeError or
    httpx.HTTPError.
    """
    for _ in range(MAX_REDIRECTS + 1):
        await check_public_url(url)
        async with client.stream("GET", url, follow_redirects=False) as resp:
            if resp.is_redirect:
                location = resp.headers.get("location")
                if not location:
                    raise httpx.HTTPError("Redirect without a Location header")
                url = urljoin(url, location)
                continue
            resp.raise_for_status()
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise DownloadTooLargeError(f"{declared} bytes")
            chunks, total = [], 0
            async for chunk in resp.aiter_bytes(64 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise DownloadTooLargeError(f"over {max_bytes} bytes")
                chunks.append(chunk)
            return b"".join(chunks), url
    raise UnsafeURLError("Too many redirects")
