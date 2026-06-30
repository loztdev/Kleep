"""World Bible entries — structured, canonical facts.

These land in the structured/graph store (Tier 1.2). One entry == one
entity; attributes are typed key/value pairs that each carry their own
provenance so individual claims about an entity can be traced, updated,
or retracted independently.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from kleep.schema.memory import MemoryAsset, MemoryKind
from kleep.schema.networks import Network
from kleep.schema.provenance import Provenance


class WorldBibleAttribute(BaseModel):
    """A single typed claim about an entity (e.g. species="Pomeranian").

    The per-attribute provenance is the whole point: when the dedup engine
    (Tier 2.5) sees a conflict, it can compare confidence/temporal_range
    on the individual attribute, not the whole entity card.
    """

    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1)
    value: Any
    provenance: Provenance


class WorldBibleEntry(MemoryAsset):
    """A canonical entity card.

    Forced into the WORLD or OBSERVATION network — Opinion/Experience
    aren't appropriate routings for hard entity facts.
    """

    kind: MemoryKind = MemoryKind.ENTITY
    entity_id: str = Field(min_length=1)
    entity_type: str = Field(min_length=1, description="e.g. 'character', 'location', 'item'.")
    canonical_name: str = Field(min_length=1)
    aliases: tuple[str, ...] = Field(default_factory=tuple)
    attributes: tuple[WorldBibleAttribute, ...] = Field(default_factory=tuple)
    summary: Optional[str] = None

    @model_validator(mode="after")
    def _check_network(self) -> "WorldBibleEntry":
        if self.network not in (Network.WORLD, Network.OBSERVATION):
            raise ValueError(
                "WorldBibleEntry must live in the WORLD or OBSERVATION network"
            )
        return self

    def get_attribute(self, key: str) -> Optional[WorldBibleAttribute]:
        for attr in self.attributes:
            if attr.key == key:
                return attr
        return None
