#!/usr/bin/env python3
"""
Council-of-agents scaffold for Gemini-based counterfeit IC inspection.

Goals:
- Run multiple lightweight specialist agents (odd count) on the same IC image set.
- Aggregate via majority/median while keeping minority reports for HITL review.
- Stay within Gemini 2.5 Flash feasibility: mostly visual checks + our local CV tools.
- Provide hooks for human feedback to become labels for policy/reward tuning later.

This is a non-invasive scaffold: it does not change the existing pipeline. It can be
called from controllers to orchestrate multiple prompts/tool calls and return a
structured consensus that the UI can render.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any, Callable
import statistics
import json

# Existing tools we can reuse without new deps
from tools.dimension_estimator import estimate_dimensions


@dataclass
class AgentTask:
    """Defines a specialist agent capability."""
    name: str
    description: str
    enabled: bool = True
    prompt_builder: Optional[Callable[[Dict[str, Any]], str]] = None  # builds Gemini prompt
    uses_local_tool: bool = False  # if true, run local CV tool instead of Gemini-only


@dataclass
class AgentVote:
    """Single agent output for consensus."""
    agent: str
    verdict: str  # e.g., AUTHENTIC | COUNTERFEIT | SUSPICIOUS | UNKNOWN
    confidence: float
    rationale: str = ""
    evidence: Dict[str, Any] = field(default_factory=dict)  # e.g., measurements, bboxes


@dataclass
class CouncilResult:
    """Aggregate output with minority reports preserved."""
    consensus_verdict: str
    consensus_confidence: float
    votes: List[AgentVote]
    numeric_scores: Dict[str, float] = field(default_factory=dict)
    minority_reports: List[AgentVote] = field(default_factory=list)


def _majority_vote(votes: List[AgentVote]) -> str:
    buckets = {}
    for v in votes:
        buckets[v.verdict] = buckets.get(v.verdict, 0) + 1
    # choose the verdict with the highest count; deterministic tie-breaker via sort
    sorted_items = sorted(buckets.items(), key=lambda kv: (-kv[1], kv[0]))
    return sorted_items[0][0] if sorted_items else "UNKNOWN"


def _median_score(scores: List[float]) -> float:
    return float(statistics.median(scores)) if scores else 0.0


class CouncilOrchestrator:
    """
    Orchestrates multiple specialist agents over the same IC inputs.

    This scaffold focuses on what Gemini can realistically support today:
    - Visual checks (markings/logo/typography, surface texture/blacktopping hints)
    - Dimension sanity (with our local dimension_estimator)
    - Lead/termination visual cues (bent/re-tinned) at a coarse level
    - PCB context (orientation vs silkscreen) when the image includes the PCB
    - Vintage/date/lot coherence as a metadata check (Gemini text reasoning)
    """

    def __init__(self, gemini_model, output_dir: str = "./detection_results"):
        self.model = gemini_model
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.tasks = self._default_tasks()

    def _default_tasks(self) -> List[AgentTask]:
        return [
            AgentTask(
                name="package_geometry",
                description="Check package type, pin count, and dimension sanity vs datasheet/expected.",
                uses_local_tool=True,
            ),
            AgentTask(
                name="markings_logo_typography",
                description="Check markings, logo micro-geometry, font/spacing, and decoded date/lot/country codes.",
            ),
            AgentTask(
                name="surface_texture",
                description="Check surface for blacktopping/sand-blast/texture anomalies and gloss mismatches.",
            ),
            AgentTask(
                name="leads_terminations",
                description="Check lead planarity/bends/re-tin evidence; coarse visual cues only.",
            ),
            AgentTask(
                name="pcb_context",
                description="If PCB present, check polarity/orientation vs silkscreen and solder joint consistency.",
            ),
            AgentTask(
                name="vintage_coherence",
                description="Check date/lot/country coherence vs part family timelines (text-only reasoning).",
            ),
            AgentTask(
                name="meta_consistency",
                description="Critique inconsistencies across other agents’ findings.",
            ),
        ]

    def run(
        self,
        image_path: str,
        datasheet_pdf: Optional[str] = None,
        parsed_specs: Optional[Dict[str, Any]] = None,
        additional_context: Optional[str] = None,
    ) -> CouncilResult:
        """
        Execute enabled tasks and aggregate results.
        This keeps calls lightweight: one Gemini pass per non-local task.
        """
        votes: List[AgentVote] = []
        scores: Dict[str, float] = {}

        # 1) Local dimension/tool-based agent (package_geometry)
        dim_vote = self._run_dimension_agent(image_path, parsed_specs)
        if dim_vote:
            votes.append(dim_vote)
            if "dimension_score" in dim_vote.evidence:
                scores["dimension_score"] = dim_vote.evidence["dimension_score"]

        # 2) Gemini-based visual agents
        for task in self.tasks:
            if not task.enabled or task.uses_local_tool:
                continue
            vote = self._run_gemini_agent(
                image_path=image_path,
                task=task,
                datasheet_pdf=datasheet_pdf,
                parsed_specs=parsed_specs,
                additional_context=additional_context,
            )
            if vote:
                votes.append(vote)
                if "score" in vote.evidence:
                    scores[f"{task.name}_score"] = vote.evidence["score"]

        # 3) Aggregate
        consensus = _majority_vote(votes)
        confs = [v.confidence for v in votes if v.confidence is not None]
        consensus_conf = _median_score(confs)

        # Preserve minority reports (anything not matching consensus)
        minority = [v for v in votes if v.verdict != consensus]

        return CouncilResult(
            consensus_verdict=consensus,
            consensus_confidence=consensus_conf,
            votes=votes,
            numeric_scores=scores,
            minority_reports=minority,
        )

    def _run_dimension_agent(self, image_path: str, parsed_specs: Optional[Dict[str, Any]]) -> Optional[AgentVote]:
        """Use the existing dimension estimator; avoid Gemini call to save cost/time."""
        try:
            dim_result, _ = estimate_dimensions(Path(image_path))
            score = float(dim_result.get("dimension_score") or dim_result.get("confidence_score") or 0.0)
            verdict = "AUTHENTIC" if score >= 80 else "SUSPICIOUS" if score >= 50 else "COUNTERFEIT"
            rationale = "Dimension match vs expected" if parsed_specs else "Dimension sanity check without datasheet"
            return AgentVote(
                agent="package_geometry",
                verdict=verdict,
                confidence=min(max(score, 0.0), 100.0),
                rationale=rationale,
                evidence={
                    "dimension_score": score,
                    "expected": parsed_specs.get("package_dimensions") if parsed_specs else None,
                    "measured": dim_result,
                },
            )
        except Exception as exc:
            return AgentVote(
                agent="package_geometry",
                verdict="UNKNOWN",
                confidence=0.0,
                rationale=f"Dimension estimator failed: {exc}",
                evidence={},
            )

    def _run_gemini_agent(
        self,
        image_path: str,
        task: AgentTask,
        datasheet_pdf: Optional[str],
        parsed_specs: Optional[Dict[str, Any]],
        additional_context: Optional[str],
    ) -> Optional[AgentVote]:
        """Single Gemini call with task-specialized prompt; returns a structured vote."""
        prompt = self._build_prompt(task, parsed_specs, additional_context)
        inputs = [prompt, {"mime_type": "image/png", "data": Path(image_path).read_bytes()}]

        if datasheet_pdf:
            inputs.append({"mime_type": "application/pdf", "data": Path(datasheet_pdf).read_bytes()})

        try:
            response = self.model.generate_content(inputs)
            text = response.text or ""
            vote = self._parse_vote_from_response(task.name, text)
            return vote
        except Exception as exc:
            return AgentVote(
                agent=task.name,
                verdict="UNKNOWN",
                confidence=0.0,
                rationale=f"Gemini call failed: {exc}",
                evidence={},
            )

    def _build_prompt(self, task: AgentTask, parsed_specs: Optional[Dict[str, Any]], ctx: Optional[str]) -> str:
        """Lightweight prompts tailored for each specialist."""
        base = f"You are a specialist agent: {task.description}\n"
        if parsed_specs:
            base += f"\nParsed specs (if useful):\n{json.dumps(parsed_specs.get('package_dimensions', {}), indent=2)}\n"
        if ctx:
            base += f"\nAdditional context from user/system:\n{ctx}\n"
        base += """
Respond in JSON with:
{
  "verdict": "AUTHENTIC|SUSPICIOUS|COUNTERFEIT|UNKNOWN",
  "confidence": 0-100,
  "rationale": "short reason",
  "score": 0-100,
  "evidence": {
    "observations": ["bullet points"],
    "flags": ["optional discrete flags"]
  }
}
"""
        return base

    def _parse_vote_from_response(self, agent_name: str, text: str) -> AgentVote:
        """Extract a structured vote from Gemini JSON-ish output."""
        def _extract_json(raw: str) -> Dict[str, Any]:
            if "```json" in raw:
                start = raw.find("```json") + 7
                end = raw.find("```", start)
                raw = raw[start:end] if end != -1 else raw[start:]
            elif "```" in raw:
                start = raw.find("```") + 3
                end = raw.find("```", start)
                raw = raw[start:end] if end != -1 else raw[start:]
            return json.loads(raw)

        try:
            parsed = _extract_json(text)
        except Exception:
            parsed = {"verdict": "UNKNOWN", "confidence": 0, "rationale": text[:200]}

        verdict = parsed.get("verdict", "UNKNOWN")
        confidence = float(parsed.get("confidence") or 0)
        rationale = parsed.get("rationale", "")
        evidence = parsed.get("evidence", {})
        score = parsed.get("score")
        if score is not None:
            try:
                evidence["score"] = float(score)
            except Exception:
                pass

        return AgentVote(
            agent=agent_name,
            verdict=verdict,
            confidence=confidence,
            rationale=rationale,
            evidence=evidence,
        )

