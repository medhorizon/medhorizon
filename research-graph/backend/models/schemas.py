"""Pydantic schemas for the research-graph API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

NodeKind = Literal["experiment", "hypothesis", "evidence", "literature", "note", "insight", "conclusion"]
Lifecycle = Literal["staged", "committed", "archived"]
EdgeRelation = Literal["supports", "contradicts", "derives", "references", "parent"]
ExperimentStatus = Literal["draft", "approved", "running", "completed", "failed", "archived"]
RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
GepaStatus = Literal["draft", "generating", "evaluating", "awaiting_gate", "selected", "completed", "stopped", "failed"]
CandidateDecision = Literal["pending", "selected", "rejected", "invalid"]


class WriteMeta(BaseModel):
    idempotency_key: str | None = None
    session_id: str | None = None
    message_id: str | None = None
    reason: str | None = None


class GraphCreate(WriteMeta):
    title: str
    summary: str | None = None


class GraphOut(BaseModel):
    id: str
    user_id: str
    title: str
    summary: str | None = None
    revision: int
    archived: bool = False
    created_at: str
    updated_at: str


class GraphPatch(WriteMeta):
    title: str | None = None
    summary: str | None = None
    archived: bool | None = None
    expected_revision: int | None = None


class NodeCreate(WriteMeta):
    graph_id: str
    kind: NodeKind
    title: str
    content: str | None = None
    hypothesis: str | None = None
    summary: str | None = None
    lifecycle: Lifecycle = "staged"
    outcome: str | None = None
    tags: list[str] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


class NodePatch(WriteMeta):
    title: str | None = None
    content: str | None = None
    hypothesis: str | None = None
    summary: str | None = None
    lifecycle: Lifecycle | None = None
    outcome: str | None = None
    tags: list[str] | None = None
    meta: dict[str, Any] | None = None
    expected_revision: int | None = None


class NodeOut(BaseModel):
    id: str
    graph_id: str
    user_id: str
    kind: str
    title: str
    content: str | None = None
    hypothesis: str | None = None
    summary: str | None = None
    lifecycle: str
    outcome: str | None = None
    tags: list[Any] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    revision: int
    created_at: str
    updated_at: str


class EdgeCreate(WriteMeta):
    graph_id: str
    source_id: str
    target_id: str
    relation: EdgeRelation
    meta: dict[str, Any] = Field(default_factory=dict)


class EdgeOut(BaseModel):
    id: str
    graph_id: str
    user_id: str
    source_id: str
    target_id: str
    relation: str
    meta: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class ExperimentCreate(WriteMeta):
    graph_id: str
    title: str
    hypothesis_node_id: str | None = None
    objective: dict[str, Any] = Field(default_factory=dict)
    dataset_refs: list[Any] = Field(default_factory=list)
    code_ref: dict[str, Any] = Field(default_factory=dict)
    parameters: dict[str, Any] = Field(default_factory=dict)
    budget: dict[str, Any] = Field(default_factory=dict)
    environment: dict[str, Any] = Field(default_factory=dict)
    baseline: dict[str, Any] = Field(default_factory=dict)


class ExperimentPatch(WriteMeta):
    title: str | None = None
    objective: dict[str, Any] | None = None
    dataset_refs: list[Any] | None = None
    code_ref: dict[str, Any] | None = None
    parameters: dict[str, Any] | None = None
    budget: dict[str, Any] | None = None
    expected_revision: int | None = None


class ExperimentOut(BaseModel):
    id: str
    graph_id: str
    hypothesis_node_id: str | None = None
    user_id: str
    title: str
    objective: dict[str, Any]
    dataset_refs: list[Any]
    code_ref: dict[str, Any]
    parameters: dict[str, Any]
    budget: dict[str, Any]
    environment: dict[str, Any] = Field(default_factory=dict)
    baseline: dict[str, Any] = Field(default_factory=dict)
    status: str
    revision: int
    created_at: str
    updated_at: str


class RunCreate(WriteMeta):
    seed: int | None = None
    dry_run: bool = True
    provenance: dict[str, Any] = Field(default_factory=dict)


class MetricIn(BaseModel):
    name: str
    value: float
    split: str | None = None
    unit: str | None = None
    evaluator: str | None = None


class RunFinish(WriteMeta):
    exit_code: int = 0
    error_code: str | None = None
    metrics: list[MetricIn] = Field(default_factory=list)


class GepaCreate(WriteMeta):
    experiment_id: str
    objective: dict[str, Any]
    budget: dict[str, Any] = Field(default_factory=lambda: {"max_iterations": 3, "max_candidates": 4, "patience": 2})
    seed: int = 42


class GepaIterate(WriteMeta):
    parent_candidate_id: str | None = None
    candidates: list[dict[str, Any]] | None = None


class SemanticSearchIn(BaseModel):
    graph_id: str
    query: str
    limit: int = 10


class AiSummarizeIn(BaseModel):
    node_id: str | None = None
    text: str | None = None


class AiChatIn(BaseModel):
    graph_id: str
    message: str


class AiHypothesisIn(BaseModel):
    graph_id: str
    prompt: str


class AiSuggestLinksIn(BaseModel):
    graph_id: str
    node_id: str


class HealthOut(BaseModel):
    status: str
    mode: str
    store: str
    openai: bool


class StageRef(BaseModel):
    name: str
    index: int | None = None
    part_id: str | None = None
    status: str | None = None
    summary: str | None = None
    gated: bool | None = None


class StageLandIn(WriteMeta):
    """Land a MedHorizon session stage onto a Research Graph node."""

    stage: StageRef
    graph_id: str | None = None
    kind: NodeKind | None = None
    title: str | None = None
    content: str | None = None
    create_graph_title: str | None = None


class SessionBindIn(WriteMeta):
    session_id: str
    graph_id: str


class SessionBindOut(BaseModel):
    session_id: str
    graph_id: str
    created_at: str
    updated_at: str
