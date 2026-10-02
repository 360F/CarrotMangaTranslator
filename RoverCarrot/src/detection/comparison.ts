import type { HayaiRegionManifest } from './geometry.js';

type Region = HayaiRegionManifest['dialogueRegions'][number];
function iou(a: Region, b: Region): number {
  const intersection = Math.max(0, Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0])) *
    Math.max(0, Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]));
  const area = (r: Region) => (r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1]);
  return intersection / (area(a) + area(b) - intersection);
}

// Identify order by unique mutual-best geometric overlap, independently of IDs.
// Ties, no overlap and non-bijective matches remain unresolved (never PASS).
// This is correspondence, not a numerical bbox acceptance threshold.
function orderMatches(reference: Region[], actual: Region[]): (number | null)[] {
  const best = (scores: number[]) => {
    const max = Math.max(...scores);
    return max > 0 && scores.filter(score => score === max).length === 1 ? scores.indexOf(max) : null;
  };
  return actual.map(region => {
    const index = best(reference.map(old => iou(old, region)));
    if (index === null) return null;
    const reverse = best(actual.map(next => iou(reference[index]!, next)));
    return reverse !== null && actual[reverse] === region ? index : null;
  });
}

export function compareManifests(reference: HayaiRegionManifest, actual: HayaiRegionManifest) {
  const kinds = ['dialogueRegions', 'effectRegions'] as const;
  const rows = kinds.flatMap(kind => {
    const old = reference[kind], next = actual[kind];
    return Array.from({ length: Math.max(old.length, next.length) }, (_, order) => {
      const a = old[order], b = next[order];
      if (!a || !b) return { kind, order, reference: a, actual: b, missing: true };
      return { kind, order, reference: a, actual: b, iou: iou(a, b),
        coordinateDelta: b.bbox.map((value, i) => value - a.bbox[i]!), confidenceDelta: b.detectorConfidence - a.detectorConfidence,
        sameType: a.kind === b.kind,
        sameProvenance: JSON.stringify(a.sourceDetectionIds) === JSON.stringify(b.sourceDetectionIds),
        sameSubdivision: JSON.stringify(a.ocrSubdivision) === JSON.stringify(b.ocrSubdivision) };
    });
  });
  const sameCounts = kinds.every(kind => reference[kind].length === actual[kind].length);
  const orderCorrespondence = Object.fromEntries(kinds.map(kind => [kind, orderMatches(reference[kind], actual[kind])]));
  const sameType = sameCounts && rows.every(row => row.sameType);
  const sameOrder = sameCounts && kinds.every(kind => orderCorrespondence[kind]!.every((index, order) => index === order));
  const sameProvenance = sameCounts && rows.every(row => row.sameProvenance);
  const sameSubdivision = sameCounts && rows.every(row => row.sameSubdivision);
  const values = rows.flatMap(row => row.iou === undefined ? [] : [row.iou]);
  return { sameCounts, sameType, sameOrder, sameProvenance, sameSubdivision, orderCorrespondence,
    exact: JSON.stringify(reference) === JSON.stringify(actual),
    iou: values.length ? { min: Math.min(...values), mean: values.reduce((a,b) => a+b,0)/values.length, max: Math.max(...values) } : null,
    rows };
}

// Status gate is count/type/order only (STEP2_VALIDATION.md, Independent rerun).
// Provenance and subdivision are informational: shown, never change status or exit code.
export function summarizeComparison(reference: HayaiRegionManifest, actual: HayaiRegionManifest,
  comparison = compareManifests(reference, actual)) {
  const status = comparison.sameCounts && comparison.sameType && comparison.sameOrder ? 'IN_PROGRESS' : 'BLOCKED';
  const counts = (manifest: HayaiRegionManifest) => `${manifest.dialogueRegions.length}/${manifest.effectRegions.length}`;
  const line = (name: string, same: boolean, role: string) => `${name.padEnd(12)}${same ? 'same' : 'MISMATCH'} — ${role}`;
  return { status, lines: [
    line('count', comparison.sameCounts, `status gate (dialogue/effect: reference ${counts(reference)}, actual ${counts(actual)})`),
    line('type', comparison.sameType, 'status gate'),
    line('order', comparison.sameOrder, 'status gate'),
    line('provenance', comparison.sameProvenance, 'informational, status unchanged'),
    line('subdivision', comparison.sameSubdivision, 'informational, status unchanged'),
  ] };
}
