import os
from datetime import datetime, timezone, timedelta
from typing import Any

from pymongo import MongoClient
from pymongo.errors import PyMongoError

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "voice_ai")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "chat_messages")

_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        _client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000, tz_aware=True)
    return _client


def get_collection():
    client = get_client()
    db = client[MONGODB_DB]
    return db[MONGODB_COLLECTION]


def save_chat_message(room: str, participant: str, speaker: str, text: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    if not text or not str(text).strip():
        return {"stored": False, "reason": "empty_text"}

    try:
        collection = get_collection()
        text_clean = str(text).strip()
        
        # Check for duplicate message within last 30 seconds to prevent duplicates
        thirty_seconds_ago = datetime.now(timezone.utc) - timedelta(seconds=30)
        duplicate = collection.find_one({
            "room": room or "voice-demo",
            "speaker": speaker or "user",
            "text": text_clean,
            "created_at": {"$gte": thirty_seconds_ago}
        })
        
        if duplicate:
            print(f"[INFO] Duplicate message detected, skipping save: {text_clean[:50]}...")
            return {"stored": False, "reason": "duplicate", "existing_id": str(duplicate.get("_id"))}
        
        document = {
            "room": room or "voice-demo",
            "participant": participant or "guest",
            "speaker": speaker or "user",
            "text": text_clean,
            "created_at": datetime.now(timezone.utc),
            "metadata": metadata or {},
        }
        result = collection.insert_one(document)
        return {"stored": True, "id": str(result.inserted_id)}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB insert failed: {exc}")
        return {"stored": False, "error": str(exc)}


def get_all_rooms(participant: str | None = None) -> list[str]:
    """Return distinct room names that have at least one message."""
    try:
        collection = get_collection()
        pipeline: list[dict[str, Any]] = []
        if participant and str(participant).strip() and str(participant).strip().lower() != "all":
            pipeline.append({"$match": {"participant": str(participant).strip()}})
        pipeline.append({"$group": {"_id": "$room"}})
        return [doc["_id"] for doc in collection.aggregate(pipeline)]
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB aggregate (rooms) failed: {exc}")
        return []


def get_conversation_history(room: str | None = None, participant: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    try:
        collection = get_collection()
        query: dict[str, Any] = {}
        
        # Only filter by room if a valid room name is actually provided
        if room and str(room).strip():
            query["room"] = room.strip()
            
        # Filter by participant if provided and not "all"
        if participant and str(participant).strip() and str(participant).strip().lower() != "all":
            query["participant"] = participant.strip()

        # Fetch, sort by creation time, and apply the limit
        cursor = collection.find(query, {"_id": 0}).sort("created_at", 1).limit(limit)
        return list(cursor)
        
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB query failed: {exc}")
        return []

def get_grouped_conversation_history(room: str | None = None, participant: str | None = None, limit: int = 50) -> dict[str, Any]:
    """Get conversation history grouped by room with agent and user messages separated."""
    try:
        collection = get_collection()
        query: dict[str, Any] = {}
        if room and room.strip():
            query["room"] = room.strip()
        if participant and str(participant).strip() and str(participant).strip().lower() != "all":
            query["participant"] = participant.strip()

        cursor = collection.find(query, {"_id": 0}).sort("created_at", 1).limit(limit)
        messages = list(cursor)

        # Group by room
        grouped: dict[str, dict[str, Any]] = {}
        for msg in messages:
            room_name = msg.get("room", "voice-demo")
            if room_name not in grouped:
                grouped[room_name] = {
                    "room": room_name,
                    "agent_messages": [],
                    "user_messages": [],
                }

            if msg.get("speaker") == "assistant":
                grouped[room_name]["agent_messages"].append(msg)
            else:
                grouped[room_name]["user_messages"].append(msg)

        return {"rooms": list(grouped.values())}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB grouped query failed: {exc}")
        return {"rooms": []}


def mongo_health() -> dict[str, Any]:
    try:
        client = get_client()
        result = client.admin.command("ping")
        return {"connected": True, "result": result}
    except Exception as exc:
        return {"connected": False, "error": str(exc)}
