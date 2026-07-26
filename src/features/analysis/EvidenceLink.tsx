import type { EvidenceReference } from '../../types/analysis';

interface EvidenceLinkProps {
  evidence: EvidenceReference;
  onOpenEvidence?: (evidence: EvidenceReference) => void;
}

export function EvidenceLink({ evidence, onOpenEvidence }: EvidenceLinkProps) {
  const target = evidence.taskId ? `#raw-task-${encodeURIComponent(evidence.taskId)}` : '#raw-answers';

  return <a href={target} onClick={(event) => {
    if (!onOpenEvidence) return;
    event.preventDefault();
    onOpenEvidence(evidence);
    window.requestAnimationFrame(() => {
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.history.replaceState(null, '', target);
    });
  }} title={evidence.label}>查看原始回答</a>;
}
