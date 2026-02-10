export type Backend = 'claude' | 'codex';

export interface ModelEntry {
  alias: string;
  modelId: string;
  backend: Backend;
}

export const MODELS: ModelEntry[] = [
  // Claude
  { alias: 'opus',      modelId: 'claude-opus-4-6',            backend: 'claude' },
  { alias: 'sonnet',    modelId: 'claude-sonnet-4-5-20250929', backend: 'claude' },
  { alias: 'haiku',     modelId: 'claude-haiku-4-5-20251001',  backend: 'claude' },
  // Codex
  { alias: 'codex',     modelId: 'gpt-5.3-codex',             backend: 'codex' },
  { alias: '5.3',       modelId: 'gpt-5.3-codex',             backend: 'codex' },
  { alias: '5.2',       modelId: 'gpt-5.2-codex',             backend: 'codex' },
  { alias: '5.1',       modelId: 'gpt-5.1-codex',             backend: 'codex' },
  { alias: '5.1-mini',  modelId: 'gpt-5.1-codex-mini',        backend: 'codex' },
  { alias: '5.1-max',   modelId: 'gpt-5.1-codex-max',         backend: 'codex' },
  { alias: 'gpt5',      modelId: 'gpt-5-codex',               backend: 'codex' },
  { alias: 'gpt5-mini', modelId: 'gpt-5-codex-mini',          backend: 'codex' },
];

/**
 * Detect which backend a model ID belongs to.
 */
export function detectBackend(modelId: string): Backend {
  const lower = modelId.toLowerCase();
  if (lower.startsWith('gpt-') || lower.includes('codex')) {
    return 'codex';
  }
  return 'claude';
}

/**
 * Resolve a user input string to a model ID and backend.
 * Tries: exact alias → exact model ID → substring match → raw passthrough.
 */
export function resolveModel(input: string): { modelId: string; backend: Backend } {
  const lower = input.toLowerCase();

  // 1. Exact alias match
  const aliasMatch = MODELS.find(m => m.alias.toLowerCase() === lower);
  if (aliasMatch) {
    return { modelId: aliasMatch.modelId, backend: aliasMatch.backend };
  }

  // 2. Exact model ID match
  const idMatch = MODELS.find(m => m.modelId.toLowerCase() === lower);
  if (idMatch) {
    return { modelId: idMatch.modelId, backend: idMatch.backend };
  }

  // 3. Substring match on model IDs (first match wins)
  const substringMatch = MODELS.find(m => m.modelId.toLowerCase().includes(lower));
  if (substringMatch) {
    return { modelId: substringMatch.modelId, backend: substringMatch.backend };
  }

  // 4. No match — use raw string, detect backend
  return { modelId: input, backend: detectBackend(input) };
}

/**
 * Get all available models for display.
 * Returns deduplicated by modelId (some aliases point to the same model).
 */
export function getAvailableModels(): ModelEntry[] {
  return MODELS;
}
