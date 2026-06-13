"""
Singleton ChromaDB client.
Ensures only ONE instance is created across the entire application lifecycle.
Fixes the bug where DocumentProcessingAgent and RAGPipeline each created
their own chromadb.PersistentClient, causing file-lock contention.
"""
from typing import Optional
import chromadb
from chromadb.utils import embedding_functions
from loguru import logger
from app.core.config import settings

_client: Optional[chromadb.PersistentClient] = None
_collection = None


def get_chroma_collection():
    """Return the shared ChromaDB collection, initialising once."""
    global _client, _collection

    if _collection is not None:
        return _collection

    logger.info("[ChromaDB] Initialising persistent client …")
    _client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)

    embed_fn = embedding_functions.GoogleGenerativeAiEmbeddingFunction(
        api_key=settings.GEMINI_API_KEY,
        model_name="models/text-embedding-004",
    )

    _collection = _client.get_or_create_collection(
        name=settings.CHROMA_COLLECTION_NAME,
        embedding_function=embed_fn,
        metadata={"hnsw:space": "cosine"},
    )

    logger.info("[ChromaDB] Collection ready")
    return _collection
