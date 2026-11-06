export const SAMPLE_STUDENT_IDS = Object.freeze(['OSAAH/DEMO/001', 'OSAAH/DEMO/002']);

export const LEGACY_SAMPLE_STUDENT_IDS = Object.freeze(['OSAAH-DEMO-001', 'OSAAH-DEMO-002']);

const canonicalByLegacy = new Map(LEGACY_SAMPLE_STUDENT_IDS.map((legacyId, index) => [legacyId, SAMPLE_STUDENT_IDS[index]]));

export function canonicalSampleStudentId(value) {
  const id = String(value ?? '').trim();
  if (SAMPLE_STUDENT_IDS.includes(id)) return id;
  return canonicalByLegacy.get(id) ?? null;
}

export function sampleStudentIdAliases(value) {
  const canonical = canonicalSampleStudentId(value);
  if (!canonical) return [];
  const index = SAMPLE_STUDENT_IDS.indexOf(canonical);
  return [canonical, LEGACY_SAMPLE_STUDENT_IDS[index]];
}

export function isSampleStudentId(value) {
  return canonicalSampleStudentId(value) !== null;
}
