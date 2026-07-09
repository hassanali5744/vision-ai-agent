from app.database import get_conversation_history, save_chat_message


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self.docs


def test_save_chat_message_stores_room_and_participant(monkeypatch):
    inserted = {}

    class FakeCollection:
        def insert_one(self, document):
            inserted["document"] = document
            return type("InsertResult", (), {"inserted_id": "abc123"})()

    monkeypatch.setattr("app.database.get_collection", lambda: FakeCollection())

    result = save_chat_message(room="room-1", participant="user-42", speaker="user", text="hello")

    assert result["stored"] is True
    assert inserted["document"]["room"] == "room-1"
    assert inserted["document"]["participant"] == "user-42"
    assert inserted["document"]["user_id"] == "user-42"


def test_history_query_uses_room_filter_without_participant(monkeypatch):
    seen_filters = []

    class FakeCollection:
        def find(self, spec, projection):
            seen_filters.append((spec, projection))
            return FakeCursor([{"text": "hello"}])

    monkeypatch.setattr("app.database.get_collection", lambda: FakeCollection())

    history = get_conversation_history(room="voice-demo", participant="")

    assert history == [{"text": "hello"}]
    assert seen_filters[0][0]["room"] == "voice-demo"
    assert "participant" not in seen_filters[0][0]


def test_grouped_history_query_uses_room_filter_without_participant(monkeypatch):
    seen_filters = []

    class FakeCollection:
        def find(self, spec, projection):
            seen_filters.append((spec, projection))
            return FakeCursor([{"room": "room-1", "speaker": "user", "text": "hi"}])

    monkeypatch.setattr("app.database.get_collection", lambda: FakeCollection())

    grouped = get_grouped_conversation_history(room="room-1", participant="")

    assert grouped["rooms"][0]["room"] == "room-1"
    assert seen_filters[0][0]["room"] == "room-1"
    assert "participant" not in seen_filters[0][0]
