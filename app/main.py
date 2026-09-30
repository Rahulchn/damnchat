import asyncio
import json
import anyio
import time
from contextlib import asynccontextmanager
from datetime import timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4
import warnings

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from .config import DATABASE_URL
from .database import Database
from .models import GroupMessage, MessageReaction, RoomShare
from .hangout import REACTIONS, valid_room, video_source, valid_position
from .schemas import JoinRoom, OutgoingMessage


STATIC_DIR = Path(__file__).parent / "static"
DEFAULT_UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}


def detect_image_type(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", IMAGE_TYPES["png"]
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", IMAGE_TYPES["jpg"]
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", IMAGE_TYPES["webp"]
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif", IMAGE_TYPES["gif"]
    return None


def sanitize_image(data: bytes, extension: str) -> bytes:
    """Decode and re-encode an image to validate it and remove embedded metadata."""
    expected_format = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP", "gif": "GIF"}[extension]
    output = BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(data)) as source:
            if source.format != expected_format:
                raise ValueError("Image format does not match its signature")
            if source.width * source.height > 25_000_000:
                raise ValueError("Image dimensions are too large")

            if expected_format == "GIF" and getattr(source, "is_animated", False):
                frame_count = getattr(source, "n_frames", 1)
                if frame_count > 200 or source.width * source.height * frame_count > 50_000_000:
                    raise ValueError("Animated image is too large")
                frames = [frame.convert("RGBA") for frame in ImageSequence.Iterator(source)]
                durations = [frame.info.get("duration", 100) for frame in ImageSequence.Iterator(source)]
                frames[0].save(
                    output, format="GIF", save_all=True, append_images=frames[1:],
                    duration=durations, loop=source.info.get("loop", 0), disposal=2,
                )
            else:
                image = ImageOps.exif_transpose(source)
                if expected_format == "JPEG":
                    image.convert("RGB").save(output, format="JPEG", quality=88, optimize=True)
                elif expected_format == "PNG":
                    image.save(output, format="PNG", optimize=True)
                elif expected_format == "WEBP":
                    if getattr(source, "is_animated", False):
                        raise ValueError("Animated WebP is not supported; use GIF instead")
                    image.save(output, format="WEBP", quality=86, method=4)
                else:
                    image.save(output, format="GIF", optimize=True)
    return output.getvalue()


def message_json(message: GroupMessage) -> dict:
    created_at = message.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return {
        "id": message.id,
        "client_id": message.client_id,
        "name": message.name,
        "avatar": message.avatar,
        "body": message.body,
        "image_url": message.image_url,
        "reply_to_id": message.reply_to_id,
        "reply_to": None,
        "party": json.loads(message.party_json) if message.party_json else None,
        "reactions": [],
        "created_at": created_at.isoformat(),
    }


async def enriched_messages(database, rows):
    if not rows:
        return []
    ids = [row.id for row in rows]
    parents = [row.reply_to_id for row in rows if row.reply_to_id]
    async with database.sessions() as session:
        replies = {row.id: row for row in await session.scalars(select(GroupMessage).where(GroupMessage.id.in_(parents)))}
        reactions = (await session.execute(select(MessageReaction.message_id, MessageReaction.emoji, func.count())
            .where(MessageReaction.message_id.in_(ids)).group_by(MessageReaction.message_id, MessageReaction.emoji))).all()
    result = []
    for row in rows:
        item = message_json(row)
        parent = replies.get(row.reply_to_id)
        if parent and parent.room_id == row.room_id:
            item["reply_to"] = {"id": parent.id, "name": parent.name, "body": parent.body[:160], "image": bool(parent.image_url)}
        item["reactions"] = [{"emoji": emoji, "count": count} for mid, emoji, count in reactions if mid == row.id]
        result.append(item)
    return result


async def get_history(database: Database, limit: int = 100, before_id: int | None = None, room_id: str = "main") -> dict:
    query = select(GroupMessage).where(GroupMessage.room_id == room_id).order_by(GroupMessage.id.desc()).limit(limit + 1)
    if before_id is not None:
        query = query.where(GroupMessage.id < before_id)
    async with database.sessions() as session:
        rows = list(await session.scalars(query))
    return {
        "messages": await enriched_messages(database, list(reversed(rows[:limit]))),
        "has_more": len(rows) > limit,
    }


class GroupRoom:
    """One in-process room. The lock orders history snapshots and committed messages."""

    def __init__(self) -> None:
        self.members: set[WebSocket] = set()
        self.lock = asyncio.Lock()
        self.sessions = {}
        self.watch = None

    def watch_snapshot(self):
        if not self.watch:
            return None
        return {**self.watch, "host_online": any(member["session_id"] == self.watch["host_id"] for member in self.sessions.values())}

    async def watch_command(self, socket, payload):
        actor = self.sessions[socket]
        action = payload.get("action")
        current = self.watch_snapshot()
        host = current and current["host_id"] == actor["session_id"]
        if current and not host and (current["host_online"] or action not in ("claim", "start")):
            return await self.send(socket, {"type": "watch_error", "message": "The host controls this watch party."})
        now = int(time.time() * 1000)
        if action == "start":
            source = video_source(payload.get("video"))
            if not source:
                return await self.send(socket, {"type": "watch_error", "message": "Use a YouTube or HTTPS MP4/WebM video link."})
            self.watch = {"id": uuid4().hex, "video": source, "host_id": actor["session_id"], "host_name": actor["name"], "position": 0, "playing": False, "updated_at": now}
        elif action == "claim" and current:
            position = current["position"] + (max(0, now-current["updated_at"])/1000 if current["playing"] else 0)
            self.watch = {**self.watch, "host_id": actor["session_id"], "host_name": actor["name"], "position": min(position, 86400), "updated_at": now}
        elif action == "sync" and host and valid_position(payload.get("position")) and type(payload.get("playing")) is bool:
            self.watch = {**self.watch, "position": payload["position"], "playing": payload["playing"], "updated_at": now}
        elif action == "stop" and host:
            self.watch = None
        else:
            return await self.send(socket, {"type": "watch_error", "message": "That watch control is unavailable."})
        await self.broadcast({"type": "watch", "watch": self.watch_snapshot(), "server_time": now})

    async def send(self, socket: WebSocket, payload: dict) -> bool:
        try:
            await asyncio.wait_for(socket.send_json(payload), timeout=3)
            return True
        except (TimeoutError, OSError, RuntimeError, WebSocketDisconnect):
            self.members.discard(socket)
            return False

    async def broadcast(self, payload: dict) -> None:
        # Concurrent sends keep one slow browser from delaying every other browser.
        await asyncio.gather(*(self.send(socket, payload) for socket in list(self.members)))

    async def presence(self) -> None:
        await self.broadcast({"type": "presence", "count": len(self.members)})


def create_app(database_url: str | None = None, upload_dir: Path | None = None) -> FastAPI:
    database = Database(database_url or DATABASE_URL)
    uploads = (upload_dir or DEFAULT_UPLOAD_DIR).resolve()
    rooms = {}

    def checked_room(value):
        if not valid_room(value):
            raise HTTPException(422, "Invalid room invite.")
        return value

    def room_uploads(room_id):
        return uploads if room_id == "main" else uploads / room_id

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await database.create_tables()
        try:
            yield
        finally:
            await database.engine.dispose()

    application = FastAPI(title="Chatter · Group Chat", lifespan=lifespan)
    application.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @application.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @application.get("/", include_in_schema=False)
    async def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @application.get("/api/messages")
    async def history(
        limit: int = Query(100, ge=1, le=200),
        before_id: int | None = Query(None, ge=1),
        room: str = "main",
    ):
        return await get_history(database, limit, before_id, checked_room(room))

    @application.post("/api/uploads", status_code=201)
    async def upload_image(request: Request, room: str = "main"):
        destination_dir = room_uploads(checked_room(room))
        declared_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        if declared_type not in IMAGE_TYPES.values():
            raise HTTPException(415, "Choose a PNG, JPEG, WebP, or GIF image.")

        declared_length = request.headers.get("content-length")
        if declared_length and declared_length.isdigit() and int(declared_length) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "Images must be 5 MB or smaller.")

        contents = bytearray()
        async for chunk in request.stream():
            if len(contents) + len(chunk) > MAX_IMAGE_BYTES:
                raise HTTPException(413, "Images must be 5 MB or smaller.")
            contents.extend(chunk)
        if not contents:
            raise HTTPException(400, "The uploaded image is empty.")

        detected = detect_image_type(bytes(contents))
        if detected is None or detected[1] != declared_type:
            raise HTTPException(415, "The file contents do not match a supported image type.")

        extension, media_type = detected
        try:
            sanitized = await asyncio.to_thread(sanitize_image, bytes(contents), extension)
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise HTTPException(415, "The image is damaged, unsafe, or unsupported.") from None
        if len(sanitized) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "The processed image is larger than 5 MB.")
        filename = f"{uuid4().hex}.{extension}"
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination = destination_dir / filename
        await asyncio.to_thread(destination.write_bytes, sanitized)
        return {"image_url": f"/api/uploads/{filename}", "media_type": media_type}

    @application.get("/api/uploads/{filename}", include_in_schema=False)
    async def uploaded_image(filename: str, room: str = "main"):
        destination_dir = room_uploads(checked_room(room))
        stem, separator, extension = filename.partition(".")
        if (
            separator != "." or len(stem) != 32
            or any(char not in "0123456789abcdef" for char in stem)
            or extension not in IMAGE_TYPES
        ):
            raise HTTPException(404)
        path = destination_dir / filename
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(
            path,
            media_type=IMAGE_TYPES[extension],
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @application.websocket("/ws")
    async def websocket_chat(socket: WebSocket):
        room_id = socket.query_params.get("room", "main")
        if not valid_room(room_id):
            await socket.close(code=1008)
            return
        room = rooms.setdefault(room_id, GroupRoom())
        session_id = uuid4().hex
        await socket.accept()
        try:
            # Names are display labels, not accounts or verified identities.
            try:
                raw = await asyncio.wait_for(socket.receive_text(), timeout=15)
                member = JoinRoom.model_validate_json(raw)
            except (ValidationError, ValueError, TimeoutError, KeyError):
                await room.send(socket, {"type": "error", "message": "Enter a name between 1 and 40 characters to join."})
                await socket.close(code=1008)
                return

            async with room.lock:
                snapshot = await get_history(database, room_id=room_id)
                async with database.sessions() as session:
                    share = await session.get(RoomShare, room_id)
                    own = (await session.execute(select(MessageReaction.message_id, MessageReaction.emoji)
                        .join(GroupMessage, GroupMessage.id == MessageReaction.message_id)
                        .where(GroupMessage.room_id == room_id, MessageReaction.client_id == str(member.client_id)))).all()
                room.sessions[socket] = {"session_id": session_id, "name": member.name}
                if not await room.send(socket, {
                    "type": "welcome", "name": member.name,
                    "avatar": member.avatar,
                    "client_id": str(member.client_id), **snapshot,
                    "session_id": session_id, "room_id": room_id,
                    "own_reactions": [{"message_id": mid, "emoji": emoji} for mid, emoji in own],
                    "watch": room.watch_snapshot(), "server_time": int(time.time() * 1000),
                    "party_next_at": share.next_at if share else 0,
                }):
                    return
                room.members.add(socket)
                await room.presence()

            last_action = 0
            while True:
                raw = await socket.receive_text()
                if len(raw) > 8192:
                    await room.send(socket, {"type": "error", "message": "Message is too large."})
                    continue
                try:
                    packet = json.loads(raw)
                except ValueError:
                    packet = {}
                if not isinstance(packet, dict):
                    packet = {}
                if packet.get("type") == "party_share":
                    if room_id == "main":
                        await room.send(socket, {"type": "party_error", "message": "Create a private room to share an invitation."})
                        continue
                    # One persisted cooldown for the whole room, not per browser/person.
                    async with room.lock:
                        now = int(time.time() * 1000)
                        public = rooms.setdefault("main", GroupRoom())
                        async with public.lock:
                            async with database.sessions() as session:
                                share = await session.get(RoomShare, room_id)
                                if share and share.next_at > now:
                                    await room.send(socket, {"type": "party_error", "message": "This room has already sent an invite. Wait for the countdown.", "next_at": share.next_at, "server_time": now})
                                    continue
                                note = packet.get("note", "")
                                if not isinstance(note, str) or len(note) > 160:
                                    await room.send(socket, {"type": "party_error", "message": "Keep your invitation under 160 characters."})
                                    continue
                                video = room.watch["video"] if room.watch else None
                                party = {"room_id": room_id, "video": video, "expires_at": now + 30 * 60 * 1000}
                                message = GroupMessage(room_id="main", client_id=str(member.client_id), name=member.name,
                                    avatar=member.avatar, body=note.strip() or "Come hang out with us.", party_json=json.dumps(party))
                                session.add(message)
                                if share:
                                    share.next_at = now + 240000
                                else:
                                    session.add(RoomShare(room_id=room_id, next_at=now + 240000))
                                await session.commit()
                                await session.refresh(message)
                            await public.broadcast({"type": "message", "message": message_json(message)})
                        await room.broadcast({"type": "party_shared", "next_at": now + 240000, "server_time": now})
                    continue
                if packet.get("type") in ("reaction", "watch"):
                    if time.monotonic() - last_action < .15:
                        continue
                    last_action = time.monotonic()
                    async with room.lock:
                        if packet["type"] == "watch":
                            if room_id == "main":
                                await room.send(socket, {"type": "watch_error", "message": "Watch together is available in private rooms. Create a room first."})
                            else:
                                await room.watch_command(socket, packet)
                        else:
                            mid, emoji = packet.get("message_id"), packet.get("emoji")
                            if type(mid) is not int or not isinstance(emoji, str) or emoji not in REACTIONS:
                                continue
                            async with database.sessions() as session:
                                target = await session.get(GroupMessage, mid)
                                if not target or target.room_id != room_id:
                                    continue
                                key = (mid, str(member.client_id), emoji)
                                existing = await session.get(MessageReaction, key)
                                if existing:
                                    await session.delete(existing)
                                else:
                                    session.add(MessageReaction(message_id=mid, client_id=str(member.client_id), emoji=emoji))
                                await session.commit()
                                count = await session.scalar(select(func.count()).select_from(MessageReaction).where(MessageReaction.message_id == mid, MessageReaction.emoji == emoji))
                            await room.broadcast({"type": "reaction", "message_id": mid, "emoji": emoji, "count": count, "client_id": str(member.client_id), "active": existing is None})
                    continue
                try:
                    outgoing = OutgoingMessage.model_validate_json(raw)
                except (ValidationError, ValueError):
                    async with room.lock:
                        await room.send(socket, {"type": "error", "message": "Send text, an uploaded image, or both."})
                    continue

                if outgoing.image_url:
                    image_name = outgoing.image_url.rsplit("/", 1)[-1]
                    if not (room_uploads(room_id) / image_name).is_file():
                        async with room.lock:
                            await room.send(socket, {"type": "error", "message": "That uploaded image is no longer available."})
                        continue

                async with room.lock:
                    try:
                        async with database.sessions() as session:
                            if outgoing.reply_to_id:
                                parent = await session.get(GroupMessage, outgoing.reply_to_id)
                                if not parent or parent.room_id != room_id:
                                    await room.send(socket, {"type": "error", "message": "That message is not in this room."})
                                    continue
                            message = GroupMessage(
                                client_id=str(member.client_id), name=member.name,
                                avatar=member.avatar, body=outgoing.body,
                                image_url=outgoing.image_url,
                                room_id=room_id, reply_to_id=outgoing.reply_to_id,
                            )
                            session.add(message)
                            await session.commit()
                            await session.refresh(message)
                    except SQLAlchemyError:
                        await room.send(socket, {"type": "error", "message": "Your message could not be saved. Please try again."})
                        continue
                    await room.broadcast({"type": "message", "message": (await enriched_messages(database, [message]))[0]})
        except (WebSocketDisconnect, OSError):
            pass
        except KeyError:
            # Binary frames are not part of this text-only protocol.
            await room.send(socket, {"type": "error", "message": "Only text messages are supported."})
            await socket.close(code=1003)
        finally:
            with anyio.CancelScope(shield=True):
                async with room.lock:
                    room.sessions.pop(socket, None)
                    if socket in room.members:
                        room.members.discard(socket)
                        await room.presence()
                        if room.watch:
                            if not room.members:
                                room.watch = None
                            await room.broadcast({"type": "watch", "watch": room.watch_snapshot(), "server_time": int(time.time() * 1000)})

    return application


app = create_app()
