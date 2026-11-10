from datetime import date
import hashlib
import json
import sqlite3

import pytest

from scripts.usage_report import build_report


def test_usage_report_is_read_only_aggregate_and_honestly_labeled(tmp_path):
    path = tmp_path / "synthetic.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE group_messages(client_id TEXT, room_id TEXT, created_at TEXT, image_url TEXT, body TEXT, name TEXT)")
        db.executemany("INSERT INTO group_messages VALUES (?,?,?,?,?,?)", [
            ("secret-client-a", "secret-room", "2026-11-09T13:00:00Z", "/secret-image", "PRIVATE TEXT", "Private Name"),
            ("secret-client-a", "secret-room", "2026-11-10 13:00:00", "/secret-image", "PRIVATE TEXT", "Private Name"),
            ("secret-client-b", "main", "2026-11-10T10:00:00+02:00", None, "PRIVATE TEXT", "Private Name"),
            ("older", "old-room", "2026-11-08 13:00:00", None, "older", "older"),
            ("future", "future-room", "2026-11-11 00:00:00", None, "future", "future"),
        ])
        db.execute("CREATE TABLE messages(body TEXT)")
        db.execute("INSERT INTO messages VALUES ('LEGACY PRIVATE CONTENT')")
    before = hashlib.sha256(path.read_bytes()).digest()
    report = build_report(path, as_of=date(2026,11,10), days=2, environment="test")
    assert report["environment"] == "test"
    assert report["counts"] == {
        "messages":3, "rooms_with_messages":2, "distinct_posting_client_ids":2,
        "days_with_messages":2, "distinct_referenced_image_urls":1,
        "posting_client_ids_on_two_or_more_days":1,
    }
    assert before == hashlib.sha256(path.read_bytes()).digest()
    for sensitive in ["secret-client", "secret-room", "/secret-image", "PRIVATE TEXT", "Private Name", "LEGACY PRIVATE CONTENT"]:
        assert sensitive not in json.dumps(report)


def test_usage_report_rejects_missing_files_and_legacy_private_schemas(tmp_path):
    path = tmp_path / "absent.db"
    with pytest.raises(FileNotFoundError):
        build_report(path, as_of=date(2026,11,10), days=30, environment="local")
    assert not path.exists()
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE messages(body TEXT)")
    with pytest.raises(ValueError, match="group_messages"):
        build_report(path, as_of=date(2026,11,10), days=30, environment="local")


def test_usage_report_validates_period_and_environment(tmp_path):
    for days in [0, -1, 367]:
        with pytest.raises(ValueError, match="period"):
            build_report(tmp_path / "none.db", as_of=date(2026,11,10), days=days, environment="test")
    with pytest.raises(ValueError, match="environment"):
        build_report(tmp_path / "none.db", as_of=date(2026,11,10), days=30, environment="unlabeled")
