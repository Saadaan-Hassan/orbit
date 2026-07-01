"""
Run this ONCE after quitting the Orbit app to remove orphaned Qdrant vectors
left over from the lain-dain build-session purge.

Usage:
  cd backend
  uv run python cleanup_orphan_qdrant_vectors.py
"""
import os
from qdrant_client import QdrantClient
from qdrant_client.http.models import PointIdsList
import sqlite3

QDRANT_PATH = os.path.expanduser("~/.orbit/qdrant_storage")
DB_PATH     = os.path.expanduser("~/.orbit/orbit.db")
COLLECTION  = "orbit_sessions"

client = QdrantClient(path=QDRANT_PATH)
db     = sqlite3.connect(DB_PATH)

# Get every point ID currently in Qdrant
all_ids: list[int] = []
offset = None
while True:
    result, next_offset = client.scroll(
        collection_name=COLLECTION,
        limit=1000,
        offset=offset,
        with_payload=False,
        with_vectors=False,
    )
    all_ids.extend(p.id for p in result)
    if next_offset is None:
        break
    offset = next_offset

print(f"Total Qdrant points: {len(all_ids)}")

# Find which IDs have no matching session in SQLite
if not all_ids:
    print("Nothing to do.")
    db.close()
    client.close()
    raise SystemExit(0)

placeholders = ",".join(str(i) for i in all_ids)
rows = db.execute(
    f"SELECT CAST(embedding_id AS INTEGER) FROM sessions WHERE embedding_id IS NOT NULL AND CAST(embedding_id AS INTEGER) IN ({placeholders})"
).fetchall()
db.close()

live_ids  = {r[0] for r in rows}
orphan_ids = [i for i in all_ids if i not in live_ids]
print(f"Orphaned vectors (no matching session): {len(orphan_ids)}")

if orphan_ids:
    client.delete(
        collection_name=COLLECTION,
        points_selector=PointIdsList(points=orphan_ids),
    )
    print(f"Deleted {len(orphan_ids)} orphaned vectors.")
else:
    print("No orphans found.")

client.close()
