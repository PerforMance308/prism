export interface Hypothesis {
  id: string;
  investigationId: string;
  description: string;
  confidence: number;
  confidenceBasis: string;
  evidenceIds: string[];
  counterEvidenceIds: string[];
  status: 'proposed' | 'investigating' | 'supported' | 'refuted' | 'inconclusive';
}
