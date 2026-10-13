"""Minimal retrieval scaffold for a future RAG workflow.

This keeps the directory ready for a vector DB or document retriever without
forcing a full implementation before the assistant is built.
"""

from __future__ import annotations

from typing import Any, Iterable


class SimpleRetriever:
    """Very small placeholder retriever.

    Replace this with a FAISS, Qdrant, Pinecone, or other vector store later.
    """

    def __init__(self, documents: Iterable[str] | None = None):
        self.documents = list(documents or [])

    def retrieve(self, query: str, k: int = 3) -> list[str]:
        if not self.documents:
            return []

        query_lower = query.lower()
        scored = []
        for doc in self.documents:
            score = 0
            for term in query_lower.split():
                if term in doc.lower():
                    score += 1
            scored.append((score, doc))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [doc for _, doc in scored[:k]]
