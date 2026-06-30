"""Tests for MemoryAsset, WorldBibleEntry, and LoreSnippet."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from kleep.schema import (
    LoreSnippet,
    MemoryAsset,
    MemoryKind,
    Network,
    WorldBibleAttribute,
    WorldBibleEntry,
)


class TestMemoryAsset:
    def test_constructs_with_provenance(self, provenance):
        a = MemoryAsset(
            network=Network.EXPERIENCE,
            kind=MemoryKind.FACT,
            content="They met at the docks.",
            provenance=provenance,
        )
        assert a.id  # auto-generated
        assert a.provenance is provenance
        assert a.relevance == 0
        assert a.entity_ids == ()

    def test_missing_provenance_rejected(self):
        with pytest.raises(ValidationError):
            MemoryAsset(  # type: ignore[call-arg]
                network=Network.EXPERIENCE,
                kind=MemoryKind.FACT,
                content="x",
            )

    def test_extra_fields_rejected(self, provenance):
        with pytest.raises(ValidationError):
            MemoryAsset(
                network=Network.EXPERIENCE,
                kind=MemoryKind.FACT,
                content="x",
                provenance=provenance,
                surprise="boo",
            )

    def test_with_relevance_returns_copy(self, provenance):
        a = MemoryAsset(
            network=Network.EXPERIENCE,
            kind=MemoryKind.FACT,
            content="x",
            provenance=provenance,
        )
        b = a.with_relevance(3)
        assert a.relevance == 0  # unchanged
        assert b.relevance == 3
        assert b.id == a.id

    def test_relevance_floors_at_zero(self, provenance):
        a = MemoryAsset(
            network=Network.EXPERIENCE,
            kind=MemoryKind.FACT,
            content="x",
            provenance=provenance,
        )
        assert a.with_relevance(-5).relevance == 0


class TestWorldBibleEntry:
    def test_happy_path(self, provenance):
        attr = WorldBibleAttribute(
            key="species", value="Pomeranian", provenance=provenance
        )
        e = WorldBibleEntry(
            network=Network.WORLD,
            content="Mojo Jojo — Pomeranian puppy.",
            provenance=provenance,
            entity_id="char:mojo",
            entity_type="character",
            canonical_name="Mojo Jojo",
            aliases=("Mojo",),
            attributes=(attr,),
        )
        assert e.kind is MemoryKind.ENTITY
        assert e.get_attribute("species") is attr
        assert e.get_attribute("missing") is None

    @pytest.mark.parametrize(
        "network", [Network.EXPERIENCE, Network.OPINION]
    )
    def test_wrong_network_rejected(self, network, provenance):
        with pytest.raises(ValidationError):
            WorldBibleEntry(
                network=network,
                content="x",
                provenance=provenance,
                entity_id="e",
                entity_type="character",
                canonical_name="X",
            )

    def test_attribute_round_trip(self, provenance):
        attr = WorldBibleAttribute(
            key="hp", value=42, provenance=provenance
        )
        e = WorldBibleEntry(
            network=Network.OBSERVATION,
            content="x",
            provenance=provenance,
            entity_id="e1",
            entity_type="character",
            canonical_name="X",
            attributes=(attr,),
        )
        restored = WorldBibleEntry.model_validate_json(e.model_dump_json())
        assert restored == e
        assert restored.attributes[0].value == 42


class TestLoreSnippet:
    def test_default_kind(self, provenance):
        s = LoreSnippet(
            network=Network.WORLD,
            content="The desert hums at noon.",
            provenance=provenance,
        )
        assert s.kind is MemoryKind.LORE
        assert s.embedding is None
        assert s.embedding_model is None

    def test_embedding_round_trip(self, provenance):
        s = LoreSnippet(
            network=Network.WORLD,
            content="x",
            provenance=provenance,
            embedding=(0.1, 0.2, 0.3),
            embedding_model="stub-v1",
        )
        restored = LoreSnippet.model_validate_json(s.model_dump_json())
        assert restored.embedding == (0.1, 0.2, 0.3)
        assert restored.embedding_model == "stub-v1"
