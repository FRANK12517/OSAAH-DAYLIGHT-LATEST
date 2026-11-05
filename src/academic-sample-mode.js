/**
 * Explicit compatibility contract for academic test-mode flags.
 * Keep this separate from the QA-parent fixture switch: academic samples are
 * generated in memory and never inserted into the production student tables.
 */
export function isSampleModeEnabled(input = {}) {
  const value = input.sampleMode ?? input.isTestMode;
  return value === true || ['true', '1', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

export const PRODUCTION_SAFE_ACADEMIC_SAMPLE_ENDPOINTS = Object.freeze(new Set([
  '/api/academic/sample/generate',
  '/api/academic/sample/mock-generate',
  '/api/academic/sample/result/pdf'
]));
