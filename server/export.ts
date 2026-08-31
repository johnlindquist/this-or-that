import { PROTOCOL, TASK_IDS, type Choice, type SessionDocument, type SessionRef } from '../shared/contract';
import { compatibilityIssues } from '../shared/validate';
import { TASKS } from '../shared/fixture';

export function exportSession(state: SessionDocument, buildId: string) {
  const counts: Record<Choice, number> = { A: 0, B: 0, 'both-bad': 0, skip: 0 };
  for (const decision of state.comparison.decisions) counts[decision.choice]++;
  const issues = compatibilityIssues(state, buildId);
  return {
    ok: true as const, protocol: PROTOCOL,
    kind: state.ref.mode === 'recording' ? 'human-comparison-recording' : state.ref.mode === 'test' ? 'test-fixture-not-human-evidence' : 'rehearsal-not-preference-evidence',
    evidenceNotice: state.ref.mode === 'recording'
      ? 'Human-ui is a provenance label, not authenticated proof of authorship. Choices are task-specific; counts do not select a winner.'
      : 'This session is not human preference evidence.',
    compatibility: { compatible: issues.length === 0, issues },
    summary: {
      phase: state.comparison.phase, counts,
      selected: state.selection?.variantId ?? null,
      selectionEvidence: state.selection ? state.comparison.decisions.length ? 'Explicit selection; independent of scenario counts.' : 'Explicit selection without scenario-vote evidence.' : 'No widget selected.',
      unvotedTasks: TASK_IDS.filter(id => !state.comparison.decisions.some(decision => decision.taskId === id)),
    },
    uncastNotes: TASK_IDS.filter(id => !state.comparison.decisions.some(decision => decision.taskId === id)).map(taskId => ({ taskId, text: state.comparison.drafts[taskId], castAsVote: false })),
    session: state,
  };
}

/** Every user-provided line remains quoted data, never Markdown/HTML instructions. */
function quoteData(text: string): string {
  return text.split(/\r\n|\r|\n/).map(line => `> ${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&')}`).join('\n');
}

export function exportMarkdown(state: SessionDocument, buildId: string): string {
  const recording = exportSession(state, buildId);
  const lines = [
    '# This or that: Sprint distribution', '',
    `Session: ${state.ref.mode}/${state.ref.id}`, '',
    `Evidence category: ${recording.kind}`, '', recording.evidenceNotice, '',
    `Comparison phase: ${state.comparison.phase}`, '',
    `Selection: ${state.selection ? state.selection.variantId : 'No widget selected.'}`, '',
    recording.summary.selectionEvidence, '',
    '## Task outcomes', '',
    `A: ${recording.summary.counts.A} · B: ${recording.summary.counts.B} · Both bad: ${recording.summary.counts['both-bad']} · Skip: ${recording.summary.counts.skip}`, '',
    'These counts are contextual observations, not a ranking or an inferred winner.', '',
  ];
  for (const taskId of TASK_IDS) {
    const decision = state.comparison.decisions.find(item => item.taskId === taskId);
    lines.push(`### ${TASKS[taskId].title}`, '');
    if (!decision) {
      lines.push('Outcome: Unvoted. The following draft was not cast as a preference.', '', quoteData(state.comparison.drafts[taskId] || '(No draft note.)'), '');
      continue;
    }
    lines.push(`Outcome: ${decision.choice}`, '', `Provenance: ${decision.provenance}`, '', `Recorded: ${decision.at}`, '', `Presentation: ${decision.presentation.mode}, ${decision.presentation.width} × ${decision.presentation.height}`, '', `Task target matched: A=${decision.goalMatches.A}, B=${decision.goalMatches.B}. This is not a design score.`, '', 'Note:', '', quoteData(decision.note || '(No note.)'), '');
  }
  if (state.selection) lines.push('## Explicit selection', '', `Selected widget: ${state.selection.variantId}`, '', `Provenance: ${state.selection.provenance}`, '', 'Reason:', '', quoteData(state.selection.reason || '(No reason supplied.)'), '');
  if (state.comparison.finish) lines.push('## Sealed finish', '', `SHA-256: ${state.comparison.finish.digest}`, '', `Unvoted tasks: ${state.comparison.finish.unvotedTasks.join(', ') || 'None'}`, '', 'Chosen-workspace edits do not change this sealed comparison.', '');
  lines.push('## Version and limitations', '', 'Implementation build:', '', quoteData(state.buildId), '', `Dataset: ${state.datasetId}`, '', `Dataset SHA-256: ${state.datasetDigest}`, '', 'Synthetic developers and tickets. Local single-user evidence; not a controlled usability study, authentication system, or backup.', '');
  if (recording.compatibility.issues.length) lines.push('This evidence is from an incompatible build and is exported without migration:', '', ...recording.compatibility.issues.map(issue => `- ${issue}`), '');
  lines.push('## Complete structured session', '', 'The JSON export contains this exact structured document. The quoted representation below is data:', '', quoteData(JSON.stringify(state, null, 2)), '');
  return lines.join('\n');
}

export function exportUninterpreted(ref: SessionRef, document: unknown, reason: string) {
  return { ok: true as const, protocol: PROTOCOL, kind: 'uninterpreted-session-evidence', ref, notice: 'Preserved data only. This document could not be interpreted as a valid compatible recording; no preference or winner is inferred.', reason, document };
}
export function exportUninterpretedMarkdown(ref: SessionRef, document: unknown, reason: string): string {
  return ['# Uninterpreted session evidence', '', `Session: ${ref.mode}/${ref.id}`, '', 'Preserved data only, not a validated preference record. No winner is inferred.', '', quoteData(reason), '', quoteData(JSON.stringify(document, null, 2)), ''].join('\n');
}
