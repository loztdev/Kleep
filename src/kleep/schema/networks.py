"""The 4-Network taxonomy from Hindsight (Tier 1.3 preview).

Defined here in Tier 1.1 because every memory asset needs to declare which
network it belongs to at creation time. The isolation *logic* — routing,
cross-network reconciliation — comes later; this is just the vocabulary.
"""

from enum import Enum


class Network(str, Enum):
    """Which of the four memory networks an asset belongs to.

    - WORLD: physics, hard rules, canonical setting facts.
    - EXPERIENCE: biographical events — what actually happened in the story.
    - OBSERVATION: neutral, currently-true facts about entities.
    - OPINION: subjective, mutable beliefs held by some viewpoint.
    """

    WORLD = "world"
    EXPERIENCE = "experience"
    OBSERVATION = "observation"
    OPINION = "opinion"
