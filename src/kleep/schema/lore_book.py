"""Lore Book snippets — descriptive prose for the vector side of storage.

A LoreSnippet is the unit the embedding/retrieval pipeline (Tier 3.6)
will operate on. We don't compute embeddings here — that's the storage
layer's job — but we leave a slot so the schema is shape-stable when
Tier 1.2 lands.
"""

from __future__ import annotations

from typing import Optional

from pydantic import Field

from kleep.schema.memory import MemoryAsset, MemoryKind


class LoreSnippet(MemoryAsset):
    """A retrievable prose fragment with semantic-search affordances."""

    kind: MemoryKind = MemoryKind.LORE
    title: Optional[str] = None
    # Embeddings are populated by the vector store at write time; the
    # schema only holds them so a snippet round-trips losslessly.
    embedding: Optional[tuple[float, ...]] = Field(
        default=None,
        description="Set by the vector store; None until indexed.",
    )
    embedding_model: Optional[str] = None
