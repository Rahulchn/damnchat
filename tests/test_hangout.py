import time
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import create_app
from app.models import RoomShare
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker


def event(ws, kind):
    for _ in range(20):
        packet = ws.receive_json()
        if packet['type'] == kind:
            return packet
    raise AssertionError(kind)


def join(ws, name):
    ws.send_json(dict(type='join', name=name, client_id=str(uuid4())))
    result = event(ws, 'welcome')
    event(ws, 'presence')
    return result


def test_rooms_replies_reactions_and_watch(tmp_path):
    app = create_app(f"sqlite+aiosqlite:///{tmp_path / 'rooms.db'}")
    room = uuid4().hex
    with TestClient(app) as client:
        with client.websocket_connect('/ws?room=' + room) as host:
            join(host, 'Host')
            host.send_json(dict(type='message', body='Private hello'))
            message = event(host, 'message')['message']
            assert client.get('/api/messages').json()['messages'] == []
            assert len(client.get('/api/messages?room=' + room).json()['messages']) == 1
            with client.websocket_connect('/ws?room=' + room) as guest:
                join(guest, 'Guest')
                guest.send_json(dict(type='message', body='A reply', reply_to_id=message['id']))
                reply = event(guest, 'message')['message']
                assert reply['reply_to']['body'] == 'Private hello'
                guest.send_json(dict(type='reaction', message_id=message['id'], emoji='🔥'))
                assert event(guest, 'reaction')['count'] == 1
                time.sleep(.16)
                guest.send_json(dict(type='reaction', message_id=message['id'], emoji='🔥'))
                assert event(guest, 'reaction')['count'] == 0
                host.send_json(dict(type='watch', action='start', video=dict(kind='youtube', id='M7lc1UVf-VE')))
                watch = event(guest, 'watch')['watch']
                assert watch['host_name'] == 'Host'
                time.sleep(.16)
                guest.send_json(dict(type='watch', action='sync', position=40, playing=True))
                assert 'host' in event(guest, 'watch_error')['message']
                host.send_json(dict(type='watch', action='sync', position=30, playing=True))
                assert event(guest, 'watch')['watch']['position'] == 30
            with client.websocket_connect('/ws') as public:
                join(public, 'Public')
                public.send_json(dict(type='message', body='Leak?', reply_to_id=message['id']))
                assert event(public, 'error')
        assert client.get('/api/messages?room=invalid').status_code == 422


def test_party_invites_cooldown_persistence_and_global_watch_block(tmp_path):
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'party.db'}"
    private = uuid4().hex
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect('/ws') as lounge, client.websocket_connect('/ws?room='+private) as host:
            join(lounge,'Lounge')
            join(host,'Host')
            lounge.send_json(dict(type='watch',action='start',video=dict(kind='youtube',id='M7lc1UVf-VE')))
            assert 'private' in event(lounge,'watch_error')['message']
            lounge.send_json(dict(type='party_share',note='Invalid'))
            assert event(lounge,'party_error')
            host.send_json(dict(type='watch',action='start',video=dict(kind='youtube',id='M7lc1UVf-VE')))
            event(host,'watch')
            host.send_json(dict(type='party_share',note='Join to see this together',room_id='main',video={'kind':'youtube','id':'spoofed'}))
            shared = event(host,'party_shared')
            invitation = event(lounge,'message')['message']
            assert invitation['party']['room_id'] == private
            assert invitation['party']['video']['id'] == 'M7lc1UVf-VE'
            assert invitation['body'] == 'Join to see this together'
            assert shared['next_at'] - shared['server_time'] == 240000
            assert len(client.get('/api/messages').json()['messages']) == 1
            with client.websocket_connect('/ws?room='+private) as guest:
                welcome = join(guest,'Guest')
                assert welcome['party_next_at'] == shared['next_at']
                guest.send_json(dict(type='party_share',note='Duplicate'))
                assert event(guest,'party_error')['next_at'] == shared['next_at']
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect('/ws?room='+private) as host:
            assert join(host,'Host')['party_next_at'] == shared['next_at']
            host.send_json(dict(type='party_share',note='After restart'))
            assert event(host,'party_error')['next_at'] == shared['next_at']
    async def expire_cooldown():
        engine = create_async_engine(database_url)
        async with async_sessionmaker(engine)() as session:
            record = await session.get(RoomShare,private)
            record.next_at = 0
            await session.commit()
        await engine.dispose()
    asyncio.run(expire_cooldown())
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect('/ws?room='+private) as host:
            join(host,'Host')
            host.send_json(dict(type='party_share',note='A fresh invitation'))
            event(host,'party_shared')
            messages = client.get('/api/messages').json()['messages']
            assert len(messages) == 2
            assert messages[-1]['party']['video'] is None
def test_audio_links_are_not_watch_party_videos():
    from app.hangout import video_source

    assert video_source({"kind": "direct", "url": "https://example.com/song.ogg"}) is None
    assert video_source({"kind": "direct", "url": "https://example.com/song.mp3"}) is None
    assert video_source({"kind": "direct", "url": "https://example.com/movie.mp4"}) is not None
