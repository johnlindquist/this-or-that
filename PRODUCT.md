# Product context

## Purpose

This or that is a reusable many-candidate preference-ranking tool. Generate ten, twenty or more variations of one subject, compare them two at a time, choose Left/Right to advance, optionally inspect deeply and leave notes, then export the winner, every candidate's rank, supporting scores and actual observations to an agent for refinement.

It is not a fixed two-prototype usability exercise. The sprint-distribution demo is one collection fed into the tool, not the tool's purpose.

## Current phase

Exploration, explicitly requested by John. Twenty independent agents each built one different UI direction; the two incumbents remain. Drafts only need to be usable enough to rank. No polish campaign or broad test/review suite in this phase. One brief ranking/export integration smoke is appropriate.

## User scene

A desktop browser, quickly judging side-by-side directions with left/right keys, or Skip, Like both and Hate both. Embedded demos are immediately interactive, including gallery previews; no mode switch or larger window is required. Notes and demo interactions must never trigger votes; Escape returns focus to the parent comparison controls. Skip is score-neutral; shared likes/hates add/subtract 16 points from each candidate's Elo-based ranking score. Equal scores share ranks, and skipped-only candidates stay unassessed. Repeated passes can refine the result.

## UI priorities

The comparison frame stays quiet and functional so candidate differences dominate. Preserve real synthetic sprint fixture data across all directions. Let structural variety—not only color—do the exploration. No supplied human winner, invented preference notes or automatic global taste-memory writes.

## Delivery

Current app: tournament/. Primary start: bun run start. Versioned agent discovery: /api/v2/discover. Human preferences persist separately from scratch demo interactions. JSON exports include source, ranking and evidence; winning HTML is standalone. Prior fixed-A/B lesson artifacts are historical and intentionally retained, not current instructions.
