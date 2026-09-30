import math
import re
from urllib.parse import urlparse

REACTIONS = {"🔥", "😂", "❤️", "👀", "💀"}


def valid_room(value):
    return isinstance(value, str) and (value == "main" or re.fullmatch(r"[0-9a-f]{32}", value) is not None)


def video_source(value):
    if not isinstance(value, dict):
        return None
    if value.get("kind") == "youtube" and isinstance(value.get("id"), str) and re.fullmatch(r"[A-Za-z0-9_-]{11}", value["id"]):
        return {"kind": "youtube", "id": value["id"]}
    if value.get("kind") == "direct" and isinstance(value.get("url"), str) and len(value["url"]) <= 2048:
        try:
            parsed = urlparse(value["url"])
            if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
                if re.search(r"\.(mp4|webm|ogv)$", parsed.path, re.I):
                    return {"kind": "direct", "url": value["url"]}
        except ValueError:
            pass
    return None


def valid_position(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 86400
