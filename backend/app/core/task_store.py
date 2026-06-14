"""
Shared in-memory task store.
Imported by both agents.py route and workflow.py to avoid circular imports.
Replace with Redis for multi-worker deployments.
"""
from typing import Dict

_task_store: Dict[str, dict] = {}