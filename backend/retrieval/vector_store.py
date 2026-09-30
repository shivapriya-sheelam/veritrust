"""
ChromaDB vector store for VeriCorp policy knowledge base.
Embeds policy chunks using local Ollama nomic-embed-text and stores in ChromaDB PersistentClient.
"""

import os
from pathlib import Path
from typing import Optional, Sequence
import chromadb
from chromadb.api.models.Collection import Collection
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
import ollama

from backend.contracts import Evidence
from backend.retrieval.document_parser import PolicyDocument, load_all_policies, parse_policy_file

# Configuration defaults matching .env.example
CHROMA_DIR = os.getenv("CHROMA_DIR", "./.chroma")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
OLLAMA_TIMEOUT_S = int(os.getenv("OLLAMA_TIMEOUT_S", "60"))
POLICIES_DIR = os.getenv("POLICIES_DIR", "./data/policies")
COLLECTION_NAME = "vericorp_policies"


class OllamaEmbeddingFunction(EmbeddingFunction[Documents]):
    """
    ChromaDB-compatible embedding function wrapping the official Ollama Python client.
    Calls Ollama client.embed() with EMBED_MODEL (nomic-embed-text).
    """

    def __init__(
        self,
        host: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout: Optional[int] = None,
    ) -> None:
        self.host = host or os.getenv("OLLAMA_HOST", OLLAMA_HOST)
        self.model_name = model_name or os.getenv("EMBED_MODEL", EMBED_MODEL)
        self.timeout = timeout or int(os.getenv("OLLAMA_TIMEOUT_S", str(OLLAMA_TIMEOUT_S)))
        self._client: Optional[ollama.Client] = None

    @property
    def client(self) -> ollama.Client:
        if self._client is None:
            self._client = ollama.Client(host=self.host, timeout=self.timeout)
        return self._client

    def __call__(self, input: Documents) -> Embeddings:
        """
        Embeds a sequence of document texts using Ollama client.embed().
        """
        if not input:
            return []
        try:
            response = self.client.embed(model=self.model_name, input=input)
            return response.embeddings
        except Exception as e:
            raise RuntimeError(
                f"Failed to generate embeddings using Ollama ({self.model_name}) at {self.host}: {e}"
            ) from e


def get_chroma_client(chroma_dir: Optional[str] = None) -> chromadb.PersistentClient:
    """
    Returns a ChromaDB PersistentClient pointing to the configured directory.
    """
    target_dir = chroma_dir or os.getenv("CHROMA_DIR", CHROMA_DIR)
    Path(target_dir).mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=target_dir)


def get_embedding_function(
    host: Optional[str] = None,
    model_name: Optional[str] = None,
) -> OllamaEmbeddingFunction:
    """
    Instantiates the OllamaEmbeddingFunction with active configuration.
    """
    return OllamaEmbeddingFunction(host=host, model_name=model_name)


def get_policy_collection(
    collection_name: str = COLLECTION_NAME,
    chroma_dir: Optional[str] = None,
    embedding_function: Optional[EmbeddingFunction] = None,
) -> Collection:
    """
    Initializes and returns the Chroma collection for VeriCorp policies.
    Creates the collection if it does not already exist.
    """
    client = get_chroma_client(chroma_dir=chroma_dir)
    ef = embedding_function or get_embedding_function()

    return client.get_or_create_collection(
        name=collection_name,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


def index_policy_documents(
    documents: Sequence[PolicyDocument],
    collection: Optional[Collection] = None,
) -> int:
    """
    Indexes policy documents into the Chroma collection.
    Uses chunk_id as the document ID and upserts idempotently.

    Args:
        documents: Sequence of parsed PolicyDocument objects.
        collection: Target Chroma collection (defaults to get_policy_collection()).

    Returns:
        int: Number of chunks upserted.
    """
    if collection is None:
        collection = get_policy_collection()

    ids: list[str] = []
    texts: list[str] = []
    metadatas: list[dict[str, str]] = []

    for doc in documents:
        for chunk in doc.chunks:
            ids.append(chunk.chunk_id)
            texts.append(chunk.text)
            metadatas.append({
                "source": chunk.source,
                "version": chunk.version,
                "chunk_id": chunk.chunk_id,
            })

    if not ids:
        return 0

    collection.upsert(
        ids=ids,
        documents=texts,
        metadatas=metadatas,
    )

    return len(ids)


def index_all_policies(
    policies_dir: Optional[str] = None,
    collection: Optional[Collection] = None,
) -> int:
    """
    Loads all policies from data/policies and indexes them into ChromaDB.
    Guarantees idempotent indexing without duplicate chunks.

    Args:
        policies_dir: Directory containing policy .md files.
        collection: Target Chroma collection.

    Returns:
        int: Total number of chunks indexed.
    """
    from backend.db.store import add_policy_version
    from datetime import datetime, timezone
    
    target_dir = policies_dir or os.getenv("POLICIES_DIR", POLICIES_DIR)
    docs = load_all_policies(policies_dir=target_dir)
    
    # Save to SQLite DB
    now = datetime.now(timezone.utc).isoformat()
    from pathlib import Path
    for doc in docs:
        file_path = Path(target_dir) / (doc.metadata.name + ".md")
        text = file_path.read_text(encoding="utf-8") if file_path.exists() else ""
        add_policy_version(
            doc.metadata.name + ".md", 
            doc.metadata.version, 
            text, 
            doc.metadata.effective_date, 
            now
        )
        
    return index_policy_documents(documents=docs, collection=collection)


def query_collection(
    query_text: str,
    n_results: int = 4,
    collection: Optional[Collection] = None,
) -> list[Evidence]:
    """
    Queries the vector collection and returns matching Evidence objects.

    Args:
        query_text: The user question or search phrase.
        n_results: Number of chunks to retrieve (default: 4).
        collection: The Chroma collection to query (defaults to get_policy_collection()).

    Returns:
        list[Evidence]: Retrieved evidence chunks.
    """
    if collection is None:
        collection = get_policy_collection()

    results = collection.query(
        query_texts=[query_text],
        n_results=n_results,
        include=["documents", "metadatas"],
    )

    evidence_list: list[Evidence] = []

    docs = results.get("documents")
    metas = results.get("metadatas")
    ids = results.get("ids")

    if not docs or not docs[0]:
        return evidence_list

    for i in range(len(docs[0])):
        text = docs[0][i]
        meta = metas[0][i] if metas and metas[0] else {}
        chunk_id = ids[0][i] if ids and ids[0] else ""

        evidence_list.append(
            Evidence(
                source=str(meta.get("source", "")),
                version=str(meta.get("version", "v1")),
                text=str(text),
                chunk_id=str(meta.get("chunk_id", chunk_id)),
            )
        )

    return evidence_list


def reindex_policy(
    name: str,
    policies_dir: Optional[str] = None,
    collection: Optional[Collection] = None,
) -> int:
    """
    Re-indexes a single policy by name.

    Deletes all existing ChromaDB chunks whose ``chunk_id`` starts with
    ``"{name}#"`` (i.e. belongs to this policy file), then parses the
    current ``.md`` file from disk and upserts its chunks atomically.

    Used when a policy is updated at runtime (PRD §6 runtime versioning and
    ``PUT /api/policies/{name}``).

    Args:
        name: Policy filename, e.g. ``"refund_policy.md"``.  The ``.md``
              suffix is optional — if omitted it is appended automatically.
        policies_dir: Directory containing policy ``.md`` files.
                      Defaults to ``POLICIES_DIR`` env var.
        collection: Target Chroma collection.  Defaults to
                    ``get_policy_collection()``.

    Returns:
        int: Number of chunks upserted for this policy after re-indexing.

    Raises:
        FileNotFoundError: If the policy file does not exist on disk.
    """
    if not name.endswith(".md"):
        name = f"{name}.md"

    if collection is None:
        collection = get_policy_collection()

    target_dir = policies_dir or os.getenv("POLICIES_DIR", POLICIES_DIR)
    file_path = Path(target_dir) / name

    if not file_path.exists():
        raise FileNotFoundError(f"Policy file not found: {file_path}")

    # 1. Find and delete all existing chunks for this policy.
    #    ChromaDB's where-filter on metadata is the safe, stable API.
    existing = collection.get(
        where={"source": name},
        include=[],  # ids only — no need to fetch documents
    )
    existing_ids: list[str] = existing.get("ids", [])
    if existing_ids:
        collection.delete(ids=existing_ids)

    # 2. Parse the current file from disk and upsert its chunks.
    doc = parse_policy_file(file_path)
    return index_policy_documents(documents=[doc], collection=collection)
