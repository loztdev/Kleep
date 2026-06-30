"""Shared fixtures for schema tests."""

import pytest

from kleep.schema import (
    ConfidenceSource,
    Provenance,
    RawQuoteAnchor,
    TemporalRange,
)


@pytest.fixture
def turn_id() -> str:
    return "turn-0012"


@pytest.fixture
def anchor(turn_id: str) -> RawQuoteAnchor:
    return RawQuoteAnchor(
        turn_id=turn_id,
        quote="Mojo Jojo is a Pomeranian puppy.",
        char_start=10,
        char_end=42,
    )


@pytest.fixture
def temporal(turn_id: str) -> TemporalRange:
    return TemporalRange(turn_start=turn_id, narrative_always=False)


@pytest.fixture
def provenance(
    turn_id: str, anchor: RawQuoteAnchor, temporal: TemporalRange
) -> Provenance:
    return Provenance(
        source_turn_id=turn_id,
        confidence_score=0.9,
        confidence_source=ConfidenceSource.USER_ASSERTED,
        raw_quote_anchors=(anchor,),
        temporal_range=temporal,
    )
