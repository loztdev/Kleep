"""Tests for the provenance primitives."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from kleep.schema import (
    ConfidenceSource,
    Provenance,
    RawQuoteAnchor,
    TemporalRange,
)


class TestRawQuoteAnchor:
    def test_minimum_fields(self, turn_id):
        a = RawQuoteAnchor(turn_id=turn_id, quote="x")
        assert a.turn_id == turn_id
        assert a.char_start is None and a.char_end is None

    def test_empty_quote_rejected(self, turn_id):
        with pytest.raises(ValidationError):
            RawQuoteAnchor(turn_id=turn_id, quote="")

    def test_partial_span_rejected(self, turn_id):
        with pytest.raises(ValidationError):
            RawQuoteAnchor(turn_id=turn_id, quote="x", char_start=0)

    def test_inverted_span_rejected(self, turn_id):
        with pytest.raises(ValidationError):
            RawQuoteAnchor(turn_id=turn_id, quote="x", char_start=10, char_end=5)

    def test_frozen(self, anchor):
        with pytest.raises(ValidationError):
            anchor.quote = "mutated"  # type: ignore[misc]


class TestTemporalRange:
    def test_open_ended(self, turn_id):
        t = TemporalRange(turn_start=turn_id)
        assert t.turn_end is None  # "still in effect"
        assert not t.narrative_always

    def test_narrative_always(self, turn_id):
        t = TemporalRange(turn_start=turn_id, narrative_always=True)
        assert t.narrative_always

    def test_always_blocks_narrative_bounds(self, turn_id):
        with pytest.raises(ValidationError):
            TemporalRange(
                turn_start=turn_id,
                narrative_always=True,
                narrative_start="dawn",
            )

    def test_missing_turn_start_rejected(self):
        with pytest.raises(ValidationError):
            TemporalRange()  # type: ignore[call-arg]


class TestProvenance:
    def test_happy_path(self, provenance, turn_id):
        assert provenance.source_turn_id == turn_id
        assert provenance.confidence_score == 0.9
        assert provenance.confidence_source is ConfidenceSource.USER_ASSERTED
        assert len(provenance.raw_quote_anchors) == 1

    @pytest.mark.parametrize("score", [-0.01, 1.01, 2.0, -1.0])
    def test_confidence_out_of_bounds(self, score, turn_id, anchor, temporal):
        with pytest.raises(ValidationError):
            Provenance(
                source_turn_id=turn_id,
                confidence_score=score,
                raw_quote_anchors=(anchor,),
                temporal_range=temporal,
            )

    def test_empty_anchors_rejected(self, turn_id, temporal):
        with pytest.raises(ValidationError):
            Provenance(
                source_turn_id=turn_id,
                confidence_score=0.5,
                raw_quote_anchors=(),
                temporal_range=temporal,
            )

    def test_anchor_must_reference_source_turn(self, turn_id, temporal):
        bad_anchor = RawQuoteAnchor(turn_id="some-other-turn", quote="x")
        with pytest.raises(ValidationError):
            Provenance(
                source_turn_id=turn_id,
                confidence_score=0.5,
                raw_quote_anchors=(bad_anchor,),
                temporal_range=temporal,
            )

    def test_default_confidence_source_is_inferred(
        self, turn_id, anchor, temporal
    ):
        p = Provenance(
            source_turn_id=turn_id,
            confidence_score=0.5,
            raw_quote_anchors=(anchor,),
            temporal_range=temporal,
        )
        assert p.confidence_source is ConfidenceSource.INFERRED

    def test_round_trip(self, provenance):
        data = provenance.model_dump()
        restored = Provenance.model_validate(data)
        assert restored == provenance

    def test_json_round_trip(self, provenance):
        blob = provenance.model_dump_json()
        restored = Provenance.model_validate_json(blob)
        assert restored == provenance

    def test_frozen(self, provenance):
        with pytest.raises(ValidationError):
            provenance.confidence_score = 0.1  # type: ignore[misc]
