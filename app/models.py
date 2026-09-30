from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class GroupMessage(Base):
    # Separate from legacy private messages: old conversations are never published.
    __tablename__ = "group_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[str] = mapped_column(String(32), default="main", server_default="main", index=True)
    client_id: Mapped[str] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(String(40))
    avatar: Mapped[str] = mapped_column(String(20), default="orbit", server_default="orbit")
    body: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reply_to_id: Mapped[int | None] = mapped_column(nullable=True)
    party_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
    )


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    message_id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(8), primary_key=True)


class RoomShare(Base):
    __tablename__ = "room_shares"
    room_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    next_at: Mapped[int] = mapped_column(BigInteger)
