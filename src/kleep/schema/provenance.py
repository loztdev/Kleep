"""Provenance primitives — required metadata for every memory asset.

These four fields together let later tiers answer "why does the system
believe this?": which turn produced it, how confident we are, the exact
quotes that pin it to the source, and the window of time it's valid for.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

# A TurnId is an opaque identifier for a single conversational turn.
# We keep it as a string so backends (UUIDs, monotonic counters, hashes)
# can choose their own scheme without churning the schema.
TurnId = Annotated[str, Field(min_length=1, description="Opaque conversational turn identifier.")]


class ConfidenceSource(str, Enum):
    """Where a confidence_score came from.

    Tier 1 just records the source; tuning (Tier 4.10) consumes it.
    """

    USER_ASSERTED = "user_asserted"          # user stated it directly
    NARRATOR_ASSERTED = "narrator_asserted"  # the GM/narrator stated it
    INFERRED = "inferred"                    # extracted by the auto-retain engine
    DERIVED = "derived"                      # produced by reflection / reasoning
    EXTERNAL = "external"                    # imported from an outside source


class RawQuoteAnchor(BaseModel):
    """An exact-text pointer back to the source material.

    Tier 4.8 ("The Why UI") renders these so users can see the literal turn
    text that justified a stored fact.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    turn_id: TurnId
    quote: str = Field(min_length=1, description="The exact substring lifted from the turn.")
    char_start: Optional[int] = Field(default=None, ge=0)
    char_end: Optional[int] = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _check_span(self) -> "RawQuoteAnchor":
        if self.char_start is not None and self.char_end is not None:
            if self.char_end <= self.char_start:
                raise ValueError("char_end must be greater than char_start")
        # Either both offsets are set, or neither — partial spans are nonsense.
        if (self.char_start is None) != (self.char_end is None):
            raise ValueError("char_start and char_end must be provided together")
        return self


class TemporalRange(BaseModel):
    """When a fact is valid.

    We track two clocks:

    * `turn_start` / `turn_end` — real-world *conversation* time. A fact
      becomes known at turn_start and (optionally) is retired at turn_end.
    * `narrative_start` / `narrative_end` — *in-fiction* time. Free-form
      strings (e.g. "Year 921 of the Third Age", "before the war") because
      narrative time has no universal calendar.

    `narrative_always` short-circuits both narrative bounds — used for
    timeless WORLD facts like physical laws.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    turn_start: TurnId
    turn_end: Optional[TurnId] = Field(default=None, description="None means 'still in effect'.")
    narrative_start: Optional[str] = Field(default=None)
    narrative_end: Optional[str] = Field(default=None)
    narrative_always: bool = Field(
        default=False,
        description="True for timeless facts (physics, hard worldbuilding rules).",
    )

    @model_validator(mode="after")
    def _check_narrative(self) -> "TemporalRange":
        if self.narrative_always and (self.narrative_start or self.narrative_end):
            raise ValueError(
                "narrative_always is incompatible with narrative_start/narrative_end"
            )
        return self


class Provenance(BaseModel):
    """The required tracking bundle every memory asset carries.

    These four pieces are non-negotiable per the Tier 1 spec — they cannot
    be added retroactively once databases start filling up, so the schema
    enforces them at construction time.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    source_turn_id: TurnId
    confidence_score: float = Field(ge=0.0, le=1.0)
    confidence_source: ConfidenceSource = ConfidenceSource.INFERRED
    raw_quote_anchors: tuple[RawQuoteAnchor, ...] = Field(min_length=1)
    temporal_range: TemporalRange

    @model_validator(mode="after")
    def _check_anchor_turn_consistency(self) -> "Provenance":
        # At least one anchor must come from the declared source turn —
        # otherwise the source_turn_id is unmoored from any actual quote.
        if not any(a.turn_id == self.source_turn_id for a in self.raw_quote_anchors):
            raise ValueError(
                "At least one raw_quote_anchor must reference source_turn_id"
            )
        return self
