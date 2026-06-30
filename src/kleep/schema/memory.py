"""The base MemoryAsset model.

Every stored item in Kleep — World Bible entry, Lore snippet, summarized
delta, reflection, opinion — is ultimately a MemoryAsset. Specialized
models (WorldBibleEntry, LoreSnippet) wrap or extend this base.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from kleep.schema.networks import Network
from kleep.schema.provenance import Provenance, TurnId


class MemoryKind(str, Enum):
    """High-level routing label.

    Tier 1.2 (storage setup) uses this to decide which engine receives
    the asset: structured/graph for FACT/ENTITY/RULE, vector for LORE,
    either for SUMMARY/REFLECTION depending on shape.
    """

    FACT = "fact"             # atomic key/value claim
    ENTITY = "entity"         # named entity card
    RULE = "rule"             # world physics, mechanics, constraint
    LORE = "lore"             # descriptive prose fragment
    SUMMARY = "summary"       # rolled-up state delta
    REFLECTION = "reflection" # produced by CARA (Tier 4.9)
    OPINION = "opinion"       # subjective belief held by a viewpoint


def _new_id() -> str:
    return uuid4().hex


class MemoryAsset(BaseModel):
    """Base class for every persisted memory.

    Subclasses add their own structured fields; everything stored must at
    minimum carry an id, a network tag, a kind, the textual content,
    and the full provenance bundle.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=_new_id, min_length=1)
    network: Network
    kind: MemoryKind
    content: str = Field(min_length=1, description="Human-readable rendering of the asset.")
    provenance: Provenance

    # Optional but commonly populated by the ingestion pipeline.
    entity_ids: tuple[str, ...] = Field(default_factory=tuple)
    tags: tuple[str, ...] = Field(default_factory=tuple)

    # Bookkeeping the dedup / state-tracking engine (Tier 2.5) will update.
    last_updated_turn: Optional[TurnId] = None
    relevance: int = Field(default=0, ge=0)

    def with_relevance(self, delta: int) -> "MemoryAsset":
        """Return a copy with relevance incremented by `delta`."""
        return self.model_copy(update={"relevance": max(0, self.relevance + delta)})
