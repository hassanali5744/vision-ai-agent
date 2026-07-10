import os
from datetime import datetime, timezone, timedelta
from typing import Any

from pymongo import MongoClient
from pymongo.errors import PyMongoError

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
MONGODB_DB = os.getenv("MONGODB_DB", "voice_ai")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "chat_messages")
MONGODB_SCRIPTS_COLLECTION = os.getenv("MONGODB_SCRIPTS_COLLECTION", "behavior_scripts")

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


def get_scripts_collection():
    client = get_client()
    db = client[MONGODB_DB]
    return db[MONGODB_SCRIPTS_COLLECTION]


async def save_chat_message(room: str, participant: str, speaker: str, text: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    if not text or not str(text).strip():
        return {"stored": False, "reason": "empty_text"}

    try:
        collection = get_collection()
        text_clean = str(text).strip()
        
        # Check for duplicate message within last 5 seconds to prevent duplicates (reduced from 30)
        five_seconds_ago = datetime.now(timezone.utc) - timedelta(seconds=5)
        duplicate = collection.find_one({
            "room": room or "voice-demo",
            "speaker": speaker or "user",
            "text": text_clean,
            "created_at": {"$gte": five_seconds_ago}
        })
        
        if duplicate:
            print(f"[INFO] Duplicate message detected, skipping save: {text_clean[:50]}...")
            return {"stored": False, "reason": "duplicate", "existing_id": str(duplicate.get("_id"))}
        
        # Get the currently active script and include it in metadata
        active_script_result = get_active_behavior_script()
        active_script_name = None
        if active_script_result.get("success") and active_script_result.get("script"):
            active_script_name = active_script_result["script"].get("name")
        
        # Merge metadata with active script name
        final_metadata = metadata or {}
        if active_script_name:
            final_metadata["active_script"] = active_script_name
        
        document = {
            "room": room or "voice-demo",
            "participant": participant or "guest",
            "speaker": speaker or "user",
            "text": text_clean,
            "created_at": datetime.now(timezone.utc),
            "metadata": final_metadata,
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


# Behavior Scripts CRUD Operations

def save_behavior_script(name: str, script: dict[str, Any], is_active: bool = False) -> dict[str, Any]:
    """Save or update a behavior script."""
    try:
        collection = get_scripts_collection()
        
        # If this script is being set as active, deactivate all other scripts first
        if is_active:
            collection.update_many({}, {"$set": {"is_active": False}})
        
        # Check if script with this name already exists
        existing = collection.find_one({"name": name})
        
        document = {
            "name": name,
            "script": script,
            "is_active": is_active,
            "updated_at": datetime.now(timezone.utc),
        }
        
        if existing:
            # Update existing script
            result = collection.update_one(
                {"name": name},
                {"$set": document}
            )
            return {"success": True, "id": str(existing["_id"]), "updated": True}
        else:
            # Create new script
            document["created_at"] = datetime.now(timezone.utc)
            result = collection.insert_one(document)
            return {"success": True, "id": str(result.inserted_id), "created": True}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB save behavior script failed: {exc}")
        return {"success": False, "error": str(exc)}


def get_behavior_script(name: str | None = None, script_id: str | None = None) -> dict[str, Any]:
    """Get a specific behavior script by name or ID."""
    try:
        collection = get_scripts_collection()
        query: dict[str, Any] = {}
        
        if name:
            query["name"] = name
        elif script_id:
            query["_id"] = script_id
        else:
            return {"success": False, "error": "Either name or script_id must be provided"}
        
        script = collection.find_one(query, {"_id": 0})
        if script:
            return {"success": True, "script": script}
        return {"success": False, "error": "Script not found"}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB get behavior script failed: {exc}")
        return {"success": False, "error": str(exc)}


def get_all_behavior_scripts() -> dict[str, Any]:
    """Get all behavior scripts."""
    try:
        collection = get_scripts_collection()
        scripts = list(collection.find({}, {"_id": 0}).sort("created_at", -1))
        return {"success": True, "scripts": scripts}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB get all behavior scripts failed: {exc}")
        return {"success": False, "error": str(exc), "scripts": []}


def get_active_behavior_script() -> dict[str, Any]:
    """Get the currently active behavior script."""
    try:
        collection = get_scripts_collection()
        script = collection.find_one({"is_active": True}, {"_id": 0})
        if script:
            return {"success": True, "script": script}
        return {"success": False, "error": "No active script found"}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB get active behavior script failed: {exc}")
        return {"success": False, "error": str(exc)}


def delete_behavior_script(name: str | None = None, script_id: str | None = None) -> dict[str, Any]:
    """Delete a behavior script by name or ID and clean up associated conversation history."""
    try:
        scripts_collection = get_scripts_collection()
        messages_collection = get_collection()
        query: dict[str, Any] = {}
        
        if name:
            query["name"] = name
        elif script_id:
            query["_id"] = script_id
        else:
            return {"success": False, "error": "Either name or script_id must be provided"}
        
        # Get the script name before deletion (for cleanup)
        script_to_delete = scripts_collection.find_one(query)
        if not script_to_delete:
            return {"success": False, "error": "Script not found"}
        
        script_name = script_to_delete.get("name")
        
        # Delete the script
        result = scripts_collection.delete_one(query)
        
        if result.deleted_count > 0:
            # Clean up all conversation messages associated with this script
            if script_name:
                delete_result = messages_collection.delete_many({
                    "metadata.active_script": script_name
                })
                print(f"[INFO] Deleted {delete_result.deleted_count} conversation messages for script '{script_name}'")
            
            return {"success": True, "deleted": result.deleted_count, "messages_cleaned": delete_result.deleted_count if script_name else 0}
        return {"success": False, "error": "Script not found"}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB delete behavior script failed: {exc}")
        return {"success": False, "error": str(exc)}


def set_active_behavior_script(name: str | None = None, script_id: str | None = None) -> dict[str, Any]:
    """Set a behavior script as active (deactivates all others)."""
    try:
        collection = get_scripts_collection()
        
        # Deactivate all scripts first
        collection.update_many({}, {"$set": {"is_active": False}})
        
        # Activate the specified script
        query: dict[str, Any] = {}
        if name:
            query["name"] = name
        elif script_id:
            query["_id"] = script_id
        else:
            return {"success": False, "error": "Either name or script_id must be provided"}
        
        result = collection.update_one(
            query,
            {"$set": {"is_active": True, "updated_at": datetime.now(timezone.utc)}}
        )
        
        if result.modified_count > 0:
            return {"success": True, "activated": True}
        return {"success": False, "error": "Script not found"}
    except PyMongoError as exc:
        print(f"[ERROR] MongoDB set active behavior script failed: {exc}")
        return {"success": False, "error": str(exc)}
