"""The daily review (climate refactor, packages 4.2 and 5.1): the planner's record in its own table.

Iris no longer writes plans or settings. Once a day, and on a manual request, it reads the daily record and writes
one review to ``planner_review`` (migration 313) through MCP ``review_write``. A review may carry a proposed band
edit: values for the house band's rows with the simulated price it quotes. It is a proposal only; the owner applies
it in the band editor or does not, because only the owner writes the band.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from verdify_schemas.band_profile import HOUSE_PARAMS
from verdify_schemas.band_rows import ANCHOR_KEYS, HOUSE_SERIES
from verdify_schemas.tunable_registry import REGISTRY

REVIEW_KINDS = ("daily", "manual")
ReviewKind = Literal["daily", "manual"]
ReviewStatus = Literal["requested", "delivered", "written", "failed"]
# Fixed classes only: provider and model text is never stored.
ReviewFailure = Literal[
    "gateway_rejected",
    "gateway_unreachable",
    "hermes_run_failed",
    "hermes_run_cancelled",
    "completed_without_review",
    "attempts_exhausted",
]
REVIEW_SUMMARY_MAX_CHARS = 4000
REVIEW_TEXT_MAX_CHARS = 1000

# The rows a proposal may name: the 24 house anchors the dashboard band editor writes to crop_band_anchors
# (``verdify_services.band_profile`` refuses any other name). One definition, shared with the editor.
BAND_PROPOSAL_PARAMS: tuple[str, ...] = HOUSE_PARAMS
# The same keys, written compactly enough to fit a tool refusal: band_<series>_{sr,sm,ss,mid} for each house series.
BAND_PROPOSAL_KEYS_TEXT = ", ".join(f"band_{series}_{{{','.join(ANCHOR_KEYS)}}}" for series in HOUSE_SERIES)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BandProposal(_Model):
    """A band edit the review proposes: the new values, the price-list rows it quotes and why."""

    anchors: dict[str, float] = Field(min_length=1, max_length=len(BAND_PROPOSAL_PARAMS) or 1)
    price: str = Field(min_length=1, max_length=REVIEW_TEXT_MAX_CHARS)
    reason: str = Field(min_length=1, max_length=REVIEW_TEXT_MAX_CHARS)

    @field_validator("price", mode="before")
    @classmethod
    def _quoted_rows_as_text(cls, price: object) -> object:
        # The reviewer quotes one or more price-list rows; a list of quoted rows is stored as one text, one row a line.
        if isinstance(price, list | tuple) and price and all(isinstance(row, str) for row in price):
            return "\n".join(row.strip() for row in price)
        return price

    @field_validator("anchors")
    @classmethod
    def _band_rows_in_range(cls, anchors: dict[str, float]) -> dict[str, float]:
        for name, value in anchors.items():
            if name not in BAND_PROPOSAL_PARAMS:
                # The allowed keys go first so that a long name, not the list, is what a refusal's cut drops.
                raise ValueError(
                    f"anchors allows only the house band anchors {BAND_PROPOSAL_KEYS_TEXT}; refused: {name[:40]}"
                )
            spec = REGISTRY[name]
            if not math.isfinite(value) or (spec.min is not None and value < spec.min):
                raise ValueError(f"{name}={value} is below {spec.min}")
            if spec.max is not None and value > spec.max:
                raise ValueError(f"{name}={value} is above {spec.max}")
        return anchors


class ReviewWrite(_Model):
    """What ``review_write`` stores on the review's row."""

    summary: str = Field(min_length=1, max_length=REVIEW_SUMMARY_MAX_CHARS)
    band_proposal: BandProposal | None = None


class ReviewWritten(_Model):
    """``review_write``'s answer."""

    run_id: str
    kind: ReviewKind
    review_date: date
    status: Literal["written"] = "written"


class ReviewRequested(_Model):
    """``review_run``'s answer: the manual request the ingestor delivers within a minute."""

    run_id: str
    kind: Literal["manual"] = "manual"
    review_date: date
    status: Literal["requested"] = "requested"
