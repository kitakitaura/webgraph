#!/usr/bin/env python3
"""Local WebGraph server with a real streaming crawler.

Run from this directory:

    python3 server.py --port 8765

Then open http://127.0.0.1:8765/
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import mimetypes
import os
import re
import sys
import time
from collections import deque
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urldefrag, urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except Exception as exc:  # pragma: no cover - surfaced in the UI
    requests = None
    BeautifulSoup = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


ROOT = Path(__file__).resolve().parent
MAX_BODY_BYTES = 2_000_000
DEFAULT_MAX_PAGES = 30
DEFAULT_MAX_RESOURCES = 240
USER_AGENT = (
    "WebGraph/1.0 (+local crawler; contact: local)"
)

ASSET_EXTENSIONS = {
    ".css": "css",
    ".js": "js",
    ".mjs": "js",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
    ".avif": "image",
    ".svg": "image",
    ".ico": "image",
    ".mp4": "video",
    ".webm": "video",
    ".mov": "video",
    ".pdf": "pdf",
    ".woff": "font",
    ".woff2": "font",
    ".ttf": "font",
    ".otf": "font",
}

TRACKING_DOMAINS = (
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "segment.com",
    "segment.io",
    "mixpanel.com",
    "amplitude.com",
    "hotjar.com",
    "fullstory.com",
    "sentry.io",
    "datadoghq-browser-agent.com",
)

SOCIAL_DOMAINS = (
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "tiktok.com",
    "pinterest.com",
)

CDN_DOMAINS = (
    "cdn.",
    "cloudfront.net",
    "cloudflare.com",
    "cloudflare.net",
    "fastly.net",
    "jsdelivr.net",
    "unpkg.com",
    "akamai",
    "static.",
    "assets.",
)

HIDDEN_PATHS = [
    "/robots.txt",
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/openapi.json",
    "/swagger.json",
    "/graphql",
    "/feed.xml",
    "/rss.xml",
    "/feed.json",
    "/manifest.json",
    "/manifest.webmanifest",
    "/service-worker.js",
    "/sw.js",
    "/.well-known/security.txt",
    "/.well-known/openapi.json",
]


def sse(payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"data: {body}\n\n".encode("utf-8")


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_url(url: str, base: str | None = None) -> str | None:
    if not url:
        return None
    url = html.unescape(url.strip())
    if not url or url.startswith(("mailto:", "tel:", "javascript:", "data:", "blob:")):
        return None
    if url.startswith("//"):
        base_scheme = urlparse(base or "https://").scheme or "https"
        url = f"{base_scheme}:{url}"
    if base:
        url = urljoin(base, url)
    try:
        url, _fragment = urldefrag(url)
        parsed = urlparse(url)
    except Exception:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    parsed = parsed._replace(fragment="")
    if parsed.path == "":
        parsed = parsed._replace(path="/")
    return parsed.geturl()


def same_registeredish_domain(host: str, root_host: str) -> bool:
    host = host.lower().split(":")[0]
    root_host = root_host.lower().split(":")[0]
    return host == root_host or host.endswith("." + root_host)


def path_name(url: str) -> str:
    parsed = urlparse(url)
    name = Path(parsed.path).name or parsed.hostname or url
    return unquote(name.replace("-", " ").replace("_", " ")).strip() or parsed.hostname or url


def title_from_url(url: str, fallback: str = "") -> str:
    parsed = urlparse(url)
    if parsed.path in {"", "/"}:
        return parsed.hostname or fallback or url
    clean = path_name(url)
    return clean[:1].upper() + clean[1:] if clean else fallback or url


def short_headers(headers: requests.structures.CaseInsensitiveDict[str] | dict[str, str]) -> dict[str, str]:
    keep = {}
    interesting = {
        "server",
        "content-type",
        "content-length",
        "cache-control",
        "location",
        "strict-transport-security",
        "content-security-policy",
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "permissions-policy",
        "cf-ray",
        "x-vercel-id",
        "x-powered-by",
        "via",
        "x-cache",
        "x-amz-cf-pop",
        "server-timing",
    }
    for key, value in headers.items():
        lower = key.lower()
        if lower in interesting or lower.startswith("x-"):
            keep[key.lower()] = str(value)[:500]
    return keep


class WebCrawler:
    def __init__(self, start_url: str, max_pages: int, max_resources: int) -> None:
        parsed = urlparse(start_url)
        self.start_url = start_url
        self.root_host = parsed.hostname or parsed.netloc
        self.origin = f"{parsed.scheme}://{parsed.netloc}"
        self.max_pages = max(1, min(max_pages, 100))
        self.max_resources = max(10, min(max_resources, 1000))
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
            }
        )
        self.queue: deque[dict[str, Any]] = deque()
        self.queued: set[str] = set()
        self.fetched: set[str] = set()
        self.nodes: dict[str, dict[str, Any]] = {}
        self.url_to_id: dict[str, str] = {}
        self.edges: dict[str, dict[str, Any]] = {}
        self.pages_fetched = 0
        self.resources_fetched = 0
        self.external_fetches = 0
        self.tech: set[str] = set()
        self.analytics: set[str] = set()
        self.cms: set[str] = set()
        self.hosting: set[str] = set()
        self.security_headers: set[str] = set()
        self.error_count = 0
        self.redirect_count = 0
        self.total_load_ms = 0
        self.final_status: dict[str, int] = {}

    def run(self):
        yield sse({"kind": "meta", "metadata": self.metadata("Starting live crawl")})
        yield from self.discover(self.start_url, None, "page", "root", fetch=True)
        for path in HIDDEN_PATHS:
            yield from self.discover(urljoin(self.origin, path), "root", "hidden", "probe", fetch=True)

        while self.queue:
            item = self.queue.popleft()
            url = item["url"]
            if url in self.fetched:
                continue
            node = self.nodes.get(self.node_id(url))
            node_type = node["type"] if node else item.get("type_hint", "page")
            if node_type == "page" and self.pages_fetched >= self.max_pages:
                continue
            if node_type != "page" and self.resources_fetched >= self.max_resources:
                continue
            if self.is_external(url) and node_type in {"external", "social"}:
                continue
            if self.is_external(url) and self.external_fetches >= 45:
                continue
            yield from self.fetch_and_process(item)

        yield sse({"kind": "meta", "metadata": self.metadata("Crawl complete")})
        yield sse(
            {
                "kind": "done",
                "summary": {
                    "nodes": len(self.nodes),
                    "edges": len(self.edges),
                    "pages": self.pages_fetched,
                    "resources": self.resources_fetched,
                    "errors": self.error_count,
                    "redirects": self.redirect_count,
                },
            }
        )

    def node_id(self, url: str) -> str:
        normalized = normalize_url(url) or url
        start = normalize_url(self.start_url) or self.start_url
        if normalized.rstrip("/") == start.rstrip("/"):
            return "root"
        digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:14]
        return f"n_{digest}"

    def edge_id(self, source: str, target: str, edge_type: str) -> str:
        digest = hashlib.sha1(f"{source}|{target}|{edge_type}".encode("utf-8")).hexdigest()[:14]
        return f"e_{digest}"

    def is_external(self, url: str) -> bool:
        host = urlparse(url).hostname or ""
        return not same_registeredish_domain(host, self.root_host)

    def discover(
        self,
        url: str,
        parent_id: str | None,
        type_hint: str | None,
        label: str,
        fetch: bool,
    ):
        normalized = normalize_url(url, self.start_url)
        if not normalized:
            return
        content_type = mimetypes.guess_type(urlparse(normalized).path)[0] or ""
        node_type = self.classify(normalized, content_type, type_hint)
        node_id = self.node_id(normalized)
        parent = self.nodes.get(parent_id) if parent_id else None
        node = self.make_node(
            normalized,
            node_type,
            status=0,
            content_type=content_type or "queued",
            title=title_from_url(normalized, self.root_host),
            parent_id=parent_id,
            parent=parent,
        )
        first_seen = node_id not in self.nodes
        self.nodes[node_id] = {**self.nodes.get(node_id, {}), **node}
        self.url_to_id[normalized] = node_id
        if first_seen:
            yield sse({"kind": "node", "node": self.nodes[node_id], "verb": "Queued"})
        if parent_id and parent_id != node_id:
            yield from self.emit_edge(parent_id, node_id, self.edge_type_for(node_type, normalized, 0), label)

        if fetch and normalized not in self.queued and normalized not in self.fetched:
            if node_type == "page" and self.pages_fetched >= self.max_pages:
                return
            if node_type != "page" and self.resources_fetched >= self.max_resources:
                return
            self.queued.add(normalized)
            self.queue.append(
                {
                    "url": normalized,
                    "parent_id": parent_id,
                    "type_hint": type_hint or node_type,
                    "label": label,
                }
            )

    def emit_edge(self, source: str, target: str, edge_type: str, label: str):
        edge_id = self.edge_id(source, target, edge_type)
        if edge_id in self.edges:
            return
        edge = {
            "id": edge_id,
            "source": source,
            "target": target,
            "type": edge_type,
            "label": label,
        }
        self.edges[edge_id] = edge
        yield sse({"kind": "edge", "edge": edge})

    def fetch_and_process(self, item: dict[str, Any]):
        url = item["url"]
        self.fetched.add(url)
        parent_id = item.get("parent_id")
        current_parent = parent_id
        current_url = url

        for _hop in range(8):
            start = time.perf_counter()
            try:
                response = self.session.get(
                    current_url,
                    timeout=(6, 12),
                    allow_redirects=False,
                    stream=True,
                )
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    chunks.append(chunk)
                    size += len(chunk)
                    if size >= MAX_BODY_BYTES:
                        break
                body = b"".join(chunks)
                response.close()
                load_ms = int((time.perf_counter() - start) * 1000)
            except requests.RequestException as exc:
                yield from self.upsert_error_node(current_url, current_parent, exc)
                return

            headers = short_headers(response.headers)
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            status = response.status_code
            load_ms = max(1, load_ms)
            self.total_load_ms += load_ms
            self.final_status[current_url] = status
            self.observe_headers(headers)

            if 300 <= status < 400 and response.headers.get("location"):
                self.redirect_count += 1
                redirect_node = self.make_node(
                    current_url,
                    "redirect",
                    status=status,
                    content_type=content_type or "text/html",
                    headers=headers,
                    size=len(body),
                    load_ms=load_ms,
                    parent_id=current_parent,
                    parent=self.nodes.get(current_parent) if current_parent else None,
                    title=f"Redirect {status}",
                )
                node_id = redirect_node["id"]
                self.nodes[node_id] = {**self.nodes.get(node_id, {}), **redirect_node}
                yield sse({"kind": "node", "node": self.nodes[node_id], "verb": "Redirect"})
                if current_parent and current_parent != node_id:
                    yield from self.emit_edge(current_parent, node_id, "redirect", "redirect")
                next_url = normalize_url(response.headers["location"], current_url)
                if not next_url:
                    return
                next_id = self.node_id(next_url)
                yield from self.discover(next_url, node_id, None, "location", fetch=False)
                yield from self.emit_edge(node_id, next_id, "redirect", "location")
                current_parent = node_id
                current_url = next_url
                continue

            text = self.decode_body(body, response.encoding)
            node_type = "error" if status >= 400 else self.classify(current_url, content_type, item.get("type_hint"))
            if status >= 400:
                self.error_count += 1
            title = self.extract_title(text, current_url, content_type) if status < 400 else f"HTTP {status} {title_from_url(current_url)}"
            node = self.make_node(
                current_url,
                node_type,
                status=status,
                content_type=content_type or "application/octet-stream",
                headers=headers,
                size=len(body),
                load_ms=load_ms,
                parent_id=current_parent,
                parent=self.nodes.get(current_parent) if current_parent else None,
                title=title,
            )
            node_id = node["id"]
            self.nodes[node_id] = {**self.nodes.get(node_id, {}), **node}
            yield sse({"kind": "node", "node": self.nodes[node_id], "verb": "Fetched"})
            if current_parent and current_parent != node_id:
                yield from self.emit_edge(current_parent, node_id, self.edge_type_for(node_type, current_url, status), item.get("label", "request"))

            if node_type == "page":
                self.pages_fetched += 1
                yield from self.parse_html_page(current_url, node_id, text)
            elif node_type in {"hidden", "api"} and self.looks_like_index(content_type, current_url):
                yield from self.parse_index_document(current_url, node_id, text)
            else:
                self.resources_fetched += 1

            if self.is_external(current_url):
                self.external_fetches += 1

            yield sse({"kind": "meta", "metadata": self.metadata("Crawling")})
            return

    def upsert_error_node(self, url: str, parent_id: str | None, exc: Exception):
        self.error_count += 1
        node = self.make_node(
            url,
            "error",
            status="ERR",
            content_type="network/error",
            headers={"error": str(exc)[:500]},
            size=0,
            load_ms=0,
            parent_id=parent_id,
            parent=self.nodes.get(parent_id) if parent_id else None,
            title=f"Network error: {title_from_url(url)}",
        )
        self.nodes[node["id"]] = {**self.nodes.get(node["id"], {}), **node}
        yield sse({"kind": "node", "node": self.nodes[node["id"]], "verb": "Error"})
        if parent_id and parent_id != node["id"]:
            yield from self.emit_edge(parent_id, node["id"], "error", "error")
        yield sse({"kind": "meta", "metadata": self.metadata("Crawling")})

    def make_node(
        self,
        url: str,
        node_type: str,
        status: int | str,
        content_type: str,
        title: str,
        parent_id: str | None,
        parent: dict[str, Any] | None,
        headers: dict[str, str] | None = None,
        size: int = 0,
        load_ms: int = 0,
    ) -> dict[str, Any]:
        parsed = urlparse(url)
        node_id = self.node_id(url)
        cluster = self.cluster_for(url, node_type)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        return {
            "id": node_id,
            "type": node_type,
            "title": title[:140] or title_from_url(url),
            "path": path,
            "url": url,
            "cluster": cluster,
            "parentId": parent_id,
            "status": status,
            "contentType": content_type or "unknown",
            "size": round(size / 1024, 1),
            "loadTime": load_ms,
            "headers": headers or {},
            "keywords": self.keywords_for(url, node_type, title, content_type),
        }

    def parse_html_page(self, url: str, node_id: str, text: str):
        soup = BeautifulSoup(text, "html.parser")
        self.detect_tech(text, soup)

        for tag in soup.find_all("a", href=True):
            target = normalize_url(tag.get("href"), url)
            if not target:
                continue
            label = (tag.get_text(" ", strip=True) or "link")[:80]
            same_site = not self.is_external(target)
            fetch = same_site and self.classify(target, "", "page") == "page"
            yield from self.discover(target, node_id, "page" if same_site else "external", label, fetch=fetch)

        for tag in soup.find_all("script"):
            src = tag.get("src")
            if src:
                target = normalize_url(src, url)
                if target:
                    yield from self.discover(target, node_id, "js", "script", fetch=self.should_fetch_asset(target))
            else:
                yield from self.discover_inline_urls(tag.string or "", url, node_id)

        for tag in soup.find_all("link", href=True):
            target = normalize_url(tag.get("href"), url)
            if not target:
                continue
            rel = " ".join(tag.get("rel") or []).lower()
            hint = "css" if "stylesheet" in rel else "hidden" if "manifest" in rel or "sitemap" in rel else None
            if "preload" in rel or "modulepreload" in rel:
                as_type = (tag.get("as") or "").lower()
                hint = {"script": "js", "style": "css", "font": "font", "image": "image"}.get(as_type, hint)
            yield from self.discover(target, node_id, hint, rel or "link", fetch=self.should_fetch_asset(target))

        for tag_name, attr, hint in [
            ("img", "src", "image"),
            ("iframe", "src", "external"),
            ("video", "src", "video"),
            ("source", "src", "video"),
            ("audio", "src", "video"),
        ]:
            for tag in soup.find_all(tag_name):
                target = normalize_url(tag.get(attr), url)
                if target:
                    yield from self.discover(target, node_id, hint, tag_name, fetch=self.should_fetch_asset(target))
                for srcset_url in self.srcset_urls(tag.get("srcset"), url):
                    yield from self.discover(srcset_url, node_id, "image", "srcset", fetch=self.should_fetch_asset(srcset_url))

        for tag in soup.find_all("form"):
            action = normalize_url(tag.get("action") or url, url)
            if action:
                method = (tag.get("method") or "GET").upper()
                yield from self.discover(action, node_id, "api", f"form {method}", fetch=not self.is_external(action))

        yield from self.discover_inline_urls(text[:300_000], url, node_id)

    def parse_index_document(self, url: str, node_id: str, text: str):
        if url.endswith("robots.txt"):
            for line in text.splitlines():
                if line.lower().startswith("sitemap:"):
                    target = normalize_url(line.split(":", 1)[1].strip(), url)
                    if target:
                        yield from self.discover(target, node_id, "hidden", "robots sitemap", fetch=True)
            return

        soup = BeautifulSoup(text, "xml" if "<urlset" in text[:500].lower() or "<sitemapindex" in text[:500].lower() else "html.parser")
        for loc in soup.find_all("loc"):
            target = normalize_url(loc.get_text(strip=True), url)
            if target and not self.is_external(target):
                yield from self.discover(target, node_id, "page", "sitemap", fetch=True)

    def discover_inline_urls(self, text: str, base_url: str, node_id: str):
        if not text:
            return
        patterns = [
            r"""["']((?:https?:)?//[^"'<>\\\s]+)["']""",
            r"""["'](/[^"'<>\\\s]*(?:api|graphql|json|feed|search|auth|login|products|assets)[^"'<>\\\s]*)["']""",
        ]
        seen: set[str] = set()
        for pattern in patterns:
            for raw in re.findall(pattern, text, flags=re.I):
                target = normalize_url(raw, base_url)
                if not target or target in seen:
                    continue
                seen.add(target)
                hint = "api" if re.search(r"/api|graphql|\.json|auth|search|products", target, flags=re.I) else None
                yield from self.discover(target, node_id, hint, "inline", fetch=self.should_fetch_inline(target, hint))
                if len(seen) > 80:
                    return

    @staticmethod
    def srcset_urls(srcset: str | None, base_url: str) -> list[str]:
        if not srcset:
            return []
        urls = []
        for part in srcset.split(","):
            raw = part.strip().split(" ")[0]
            target = normalize_url(raw, base_url)
            if target:
                urls.append(target)
        return urls

    def should_fetch_asset(self, url: str) -> bool:
        node_type = self.classify(url, mimetypes.guess_type(urlparse(url).path)[0] or "", None)
        if node_type in {"external", "social"}:
            return False
        if self.resources_fetched >= self.max_resources:
            return False
        return True

    def should_fetch_inline(self, url: str, hint: str | None) -> bool:
        if hint == "api":
            return self.resources_fetched < self.max_resources
        return self.should_fetch_asset(url)

    def classify(self, url: str, content_type: str, hint: str | None = None) -> str:
        if hint in {"page", "api", "image", "video", "pdf", "css", "js", "font", "hidden"}:
            return hint
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        path = parsed.path.lower()
        ext = Path(path).suffix
        content_type = (content_type or "").lower()

        if any(domain in host for domain in TRACKING_DOMAINS):
            return "analytics" if "tagmanager" in host else "tracking"
        if any(domain in host for domain in SOCIAL_DOMAINS):
            return "social"
        if path in HIDDEN_PATHS or any(mark in path for mark in ("sitemap", "robots.txt", "manifest", "security.txt", "openapi", "swagger")):
            return "hidden"
        if "json" in content_type or "graphql" in content_type or re.search(r"/api|graphql|\.json($|\?)", path):
            return "api"
        if content_type.startswith("image/") or ASSET_EXTENSIONS.get(ext) == "image":
            return "image"
        if content_type.startswith("video/") or ASSET_EXTENSIONS.get(ext) == "video":
            return "video"
        if "pdf" in content_type or ASSET_EXTENSIONS.get(ext) == "pdf":
            return "pdf"
        if "css" in content_type or ASSET_EXTENSIONS.get(ext) == "css":
            return "css"
        if "javascript" in content_type or "ecmascript" in content_type or ASSET_EXTENSIONS.get(ext) == "js":
            return "js"
        if "font" in content_type or ASSET_EXTENSIONS.get(ext) == "font":
            return "font"
        if self.is_external(url):
            if any(marker in host for marker in CDN_DOMAINS):
                return "cdn"
            return "external"
        if host != self.root_host.lower() and same_registeredish_domain(host, self.root_host):
            return "subdomain"
        return "page"

    def edge_type_for(self, node_type: str, url: str, status: int | str) -> str:
        if isinstance(status, int) and status >= 400:
            return "error"
        if node_type == "redirect":
            return "redirect"
        if node_type in {"api", "hidden"}:
            return "api"
        if node_type in {"image", "video", "pdf", "css", "js", "font", "cdn"}:
            return "asset"
        if node_type in {"external", "service", "analytics", "tracking", "social"} or self.is_external(url):
            return "external"
        return "internal"

    def cluster_for(self, url: str, node_type: str) -> str:
        host = (urlparse(url).hostname or self.root_host).lower()
        if node_type == "page":
            return "Pages"
        if node_type == "api":
            return "APIs"
        if node_type in {"image", "video", "pdf", "css", "js", "font", "cdn"}:
            return "Assets"
        if node_type in {"analytics", "tracking"}:
            return "Analytics"
        if node_type == "social":
            return "Social"
        if node_type == "hidden":
            return "Hidden Discovery"
        if node_type == "error":
            return "Errors"
        if node_type == "redirect":
            return "Redirects"
        if host != self.root_host.lower() and same_registeredish_domain(host, self.root_host):
            return "Subdomains"
        if self.is_external(url):
            return host.replace("www.", "")
        return "Core"

    def keywords_for(self, url: str, node_type: str, title: str, content_type: str) -> list[str]:
        text = f"{url} {title} {node_type} {content_type}".lower()
        words = [node_type]
        for key in ["auth", "login", "session", "product", "pricing", "checkout", "search", "pagination", "graphql", "openapi", "image", "cdn", "tracking", "analytics"]:
            if key in text:
                words.append(key)
        return sorted(set(words))

    def extract_title(self, text: str, url: str, content_type: str) -> str:
        if "html" not in content_type:
            return title_from_url(url)
        try:
            soup = BeautifulSoup(text[:200_000], "html.parser")
            if soup.title and soup.title.get_text(strip=True):
                return soup.title.get_text(" ", strip=True)[:140]
            heading = soup.find(["h1", "h2"])
            if heading and heading.get_text(strip=True):
                return heading.get_text(" ", strip=True)[:140]
        except Exception:
            pass
        return title_from_url(url)

    @staticmethod
    def decode_body(body: bytes, encoding: str | None) -> str:
        if not body:
            return ""
        for candidate in [encoding, "utf-8", "latin-1"]:
            if not candidate:
                continue
            try:
                return body.decode(candidate, errors="replace")
            except Exception:
                continue
        return body.decode("utf-8", errors="replace")

    @staticmethod
    def looks_like_index(content_type: str, url: str) -> bool:
        path = urlparse(url).path.lower()
        return any(path.endswith(suffix) for suffix in (".xml", ".txt", ".json")) or any(token in content_type for token in ("xml", "json", "text"))

    def observe_headers(self, headers: dict[str, str]) -> None:
        lower_keys = set(headers.keys())
        for header in ["strict-transport-security", "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]:
            if header in lower_keys:
                self.security_headers.add(header)

        header_text = " ".join(f"{k}: {v}" for k, v in headers.items()).lower()
        if "cloudflare" in header_text or "cf-ray" in lower_keys:
            self.hosting.add("Cloudflare")
        if "vercel" in header_text or "x-vercel-id" in lower_keys:
            self.hosting.add("Vercel")
        if "x-amz-cf-pop" in lower_keys or "cloudfront" in header_text:
            self.hosting.add("AWS CloudFront")
        if "fastly" in header_text:
            self.hosting.add("Fastly")
        if "nginx" in header_text:
            self.hosting.add("nginx")
        if "apache" in header_text:
            self.hosting.add("Apache")
        if "x-powered-by" in lower_keys:
            value = headers.get("x-powered-by", "")
            if value:
                self.tech.add(value[:40])

    def detect_tech(self, text: str, soup: Any) -> None:
        low = text[:500_000].lower()
        if "__next_data__" in low or "/_next/static/" in low:
            self.tech.add("Next.js")
        if "gatsby" in low:
            self.tech.add("Gatsby")
        if "nuxt" in low or "__nuxt" in low:
            self.tech.add("Nuxt")
        if "svelte" in low:
            self.tech.add("Svelte")
        if "react" in low:
            self.tech.add("React")
        if "vue" in low:
            self.tech.add("Vue")
        if "wp-content" in low or "wp-includes" in low:
            self.cms.add("WordPress")
        if "shopify" in low:
            self.cms.add("Shopify")
        if "contentful" in low:
            self.cms.add("Contentful")
        if "sanity" in low:
            self.cms.add("Sanity")
        for domain in TRACKING_DOMAINS:
            if domain in low:
                self.analytics.add(domain)

        generator = soup.find("meta", attrs={"name": re.compile("^generator$", re.I)})
        if generator and generator.get("content"):
            self.cms.add(generator["content"][:60])

    def metadata(self, phase: str) -> dict[str, Any]:
        nodes = list(self.nodes.values())
        statuses = [node.get("status") for node in nodes if isinstance(node.get("status"), int) and node.get("status")]
        avg_load = int(self.total_load_ms / max(1, len(statuses)))
        external_domains = {
            urlparse(node["url"]).hostname
            for node in nodes
            if node.get("url") and self.is_external(node["url"])
        }
        robots = self.status_for_path("/robots.txt")
        sitemap = self.status_for_path("/sitemap.xml") or self.status_for_path("/sitemap_index.xml")
        risk = min(
            99,
            8
            + self.error_count * 7
            + self.redirect_count * 2
            + len(self.analytics) * 5
            + max(0, 4 - len(self.security_headers)) * 6,
        )
        performance = max(1, min(99, 100 - int(avg_load / 35) - self.error_count * 2 - self.redirect_count))
        hosting = ", ".join(sorted(self.hosting)) or "Unknown"
        framework = ", ".join(sorted(self.tech)) or "Unknown"
        cms = ", ".join(sorted(self.cms)) or "Not detected"
        analytics = ", ".join(sorted(self.analytics)) or "Not detected"
        stack = [item for item in [hosting, framework, cms, analytics, "Live crawler"] if item and item != "Unknown"]
        if not stack:
            stack = ["Live crawler"]

        return {
            "hosting": hosting,
            "framework": framework,
            "cms": cms,
            "analytics": analytics,
            "robots": self.pretty_status(robots),
            "sitemap": self.pretty_status(sitemap),
            "securityHeaders": ", ".join(sorted(self.security_headers)) or "Not detected",
            "performanceScore": performance,
            "riskScore": risk,
            "stack": stack[:8],
            "summary": (
                f"{phase}: {self.root_host} has streamed {len(nodes)} real resources, "
                f"{len(self.edges)} relationships, {self.pages_fetched} fetched pages, "
                f"{len(external_domains)} external domains, and {self.error_count} errors."
            ),
        }

    def status_for_path(self, path: str) -> int | None:
        target = urljoin(self.origin, path)
        for url, status in self.final_status.items():
            if normalize_url(url) == normalize_url(target):
                return status
        return None

    @staticmethod
    def pretty_status(status: int | None) -> str:
        if status is None:
            return "Not checked yet"
        if 200 <= status < 400:
            return f"Found ({status})"
        return f"Missing ({status})"


class WebGraphHandler(SimpleHTTPRequestHandler):
    server_version = "WebGraphHTTP/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/scan":
            self.handle_scan(parsed.query)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def handle_scan(self, query: str) -> None:
        params = parse_qs(query)
        raw_url = (params.get("url") or [""])[0].strip()
        max_pages = self.safe_int((params.get("max_pages") or [DEFAULT_MAX_PAGES])[0], DEFAULT_MAX_PAGES)
        max_resources = self.safe_int((params.get("max_resources") or [DEFAULT_MAX_RESOURCES])[0], DEFAULT_MAX_RESOURCES)
        normalized = normalize_url(raw_url if re.match(r"^https?://", raw_url, re.I) else f"https://{raw_url}")

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        def write(payload: dict[str, Any]) -> None:
            self.wfile.write(sse(payload))
            self.wfile.flush()

        if IMPORT_ERROR is not None:
            write({"kind": "error", "message": f"Missing crawler dependency: {IMPORT_ERROR}"})
            return
        if not normalized:
            write({"kind": "error", "message": "Enter a valid http(s) URL."})
            return

        crawler = WebCrawler(normalized, max_pages=max_pages, max_resources=max_resources)
        try:
            for chunk in crawler.run():
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            write({"kind": "error", "message": f"Crawl failed: {exc}"})

    @staticmethod
    def safe_int(value: str, fallback: int) -> int:
        try:
            return int(value)
        except Exception:
            return fallback

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format % args))


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve WebGraph and stream real crawler data.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()

    os.chdir(ROOT)
    server = ThreadingHTTPServer((args.host, args.port), WebGraphHandler)
    print(f"WebGraph live crawler running at http://{args.host}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping WebGraph.", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
