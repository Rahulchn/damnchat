"""Read-only, aggregate evidence from an explicitly selected FastAPI SQLite DB.

This does not access Cloudflare, add telemetry, or equate browser IDs with people.
"""
import argparse
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3


def build_report(database: Path, *, as_of: date, days: int, environment: str) -> dict:
    if not 1 <= days <= 366:
        raise ValueError("Choose a period from 1 to 366 days.")
    if environment not in {"local", "test", "production"}:
        raise ValueError("Label the source environment explicitly.")
    database = database.resolve(strict=True)
    if not database.is_file():
        raise ValueError("Select a SQLite database file.")
    start = as_of - timedelta(days=days - 1)
    end = as_of + timedelta(days=1)
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        connection.execute("PRAGMA query_only = ON")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(group_messages)")}
        if not {"client_id", "room_id", "created_at", "image_url"}.issubset(columns):
            raise ValueError("Expected a current FastAPI group_messages schema; not a Cloudflare export or legacy private-message DB.")
        activity = """
            WITH activity AS (
                SELECT client_id, room_id, date(created_at) AS day, image_url
                FROM group_messages
                WHERE datetime(created_at) >= datetime(?)
                  AND datetime(created_at) < datetime(?)
            )
        """
        parameters = (start.isoformat(), end.isoformat())
        counts = connection.execute(activity + """
            SELECT COUNT(*), COUNT(DISTINCT room_id), COUNT(DISTINCT client_id),
                   COUNT(DISTINCT day), COUNT(DISTINCT image_url)
            FROM activity
        """, parameters).fetchone()
        returning = connection.execute(activity + """
            SELECT COUNT(*) FROM (
                SELECT client_id FROM activity GROUP BY client_id
                HAVING COUNT(DISTINCT day) >= 2
            )
        """, parameters).fetchone()[0]
    return {
        "source": "fastapi_sqlite_stored_messages",
        "environment": environment,
        "period_utc": {"start_inclusive": start.isoformat(), "end_inclusive": as_of.isoformat()},
        "counts": {
            "messages": counts[0], "rooms_with_messages": counts[1],
            "distinct_posting_client_ids": counts[2], "days_with_messages": counts[3],
            "distinct_referenced_image_urls": counts[4],
            "posting_client_ids_on_two_or_more_days": returning,
        },
        "limitations": [
            "Client IDs are unverified per-tab identifiers, not unique people or accounts.",
            "Includes any bot, maintainer, QA, or synthetic traffic present in the selected DB.",
            "Counts observed posting activity, not all visitors, rooms created, or watch-party sessions.",
            "Deleted or unavailable history is not reconstructed; unparseable timestamps are omitted.",
            "Local/test databases are not evidence of production adoption. This does not read the Cloudflare deployment.",
            "Review aggregates before sharing; no message text, names, IDs, room links, or image URLs are included.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--environment", required=True, choices=["local", "test", "production"])
    parser.add_argument("--days", default=30, type=int)
    parser.add_argument("--as-of", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    args = parser.parse_args()
    try:
        report = build_report(args.database, as_of=args.as_of, days=args.days, environment=args.environment)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
