"""
WebSocket connection registry — one "room" per service. A citizen watching
their ticket and a staff console both subscribe to the service they care
about; any ticket state change for that service broadcasts to everyone in
the room. Rooms are keyed by service_id rather than branch_id because that's
the actual unit citizens queue against — a branch-wide room would wake up
every connected client on every unrelated service's ticket change.
"""
from fastapi import WebSocket


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, service_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(service_id, []).append(ws)

    def disconnect(self, service_id: str, ws: WebSocket):
        conns = self.rooms.get(service_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self.rooms.pop(service_id, None)

    async def broadcast(self, service_id: str, payload: dict):
        dead = []
        for ws in self.rooms.get(service_id, []):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(service_id, ws)


manager = RoomManager()
