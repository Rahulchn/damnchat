import xml.etree.ElementTree as ET

from fastapi.testclient import TestClient

from app.main import create_app


def test_public_company_pages_are_accessible_to_crawlers(tmp_path):
    with TestClient(create_app(f"sqlite+aiosqlite:///{tmp_path / 'pages.db'}")) as client:
        for path in ("/", "/about", "/privacy"):
            response = client.get(path, headers={"User-Agent": "Googlebot"})
            assert response.status_code == 200
            assert "Damn Chat" in response.text
            assert response.headers["x-robots-tag"] == "index, follow"
            assert client.head(path).status_code == 200
        assert "Founded January 2026" in client.get("/about").text
        assert "not end-to-end encrypted" in client.get("/privacy").text
        assert "Cancel reply" in client.get("/").text


def test_sitemap_is_public_pages_only_and_chat_is_noindex(tmp_path):
    with TestClient(create_app(f"sqlite+aiosqlite:///{tmp_path / 'crawler.db'}")) as client:
        robots = client.get("/robots.txt")
        assert robots.status_code == 200
        assert robots.headers["content-type"].startswith("text/plain")
        assert "User-agent: *\nAllow: /\nDisallow: /api/" in robots.text.replace("\r\n", "\n")
        sitemap = client.get("/sitemap.xml")
        assert sitemap.status_code == 200
        assert sitemap.headers["content-type"].startswith("application/xml")
        root = ET.fromstring(sitemap.text)
        assert [item.text for item in root.findall(".//{*}loc")] == [
            "https://damnchat.me/", "https://damnchat.me/about", "https://damnchat.me/privacy"
        ]
        for path in ("/?room=" + "a" * 32, "/?room=main", "/api/messages", "/static/index.html", "/docs"):
            assert client.get(path).headers["x-robots-tag"] == "noindex, nofollow"
