export {
  constraintKind,
  ExpectSchema,
  type Fixture,
  FixtureSchema,
  FollowupSchema,
  type ValueConstraint,
  ValueConstraintSchema,
} from './fixtureSchema.js';

export { DEFAULT_FIXTURES_DIR, loadFixtures } from './fixtures.js';
export { findHallucinations, walkYamlPaths } from './hallucination.js';
export { buildAllowedPathSet, normalizeYamlPath, PRESERVE_CHILD_KEYS, splitVariantSuffix } from './paths.js';
export { type RoundTripResult, roundTripDiff } from './roundTrip.js';
export type { RubricFailure, RubricResult } from './rubric.js';
export { evaluateRubric } from './rubric.js';
export {
  buildSafeDefaults,
  findWeakenedDefaults,
  SAFE_DEFAULT_SEEDS,
  type WeakenedDefault,
} from './safeDefaults.js';
export {
  type CrossFieldConstraint,
  type FieldRecord,
  loadSchemaArtifact,
  type ReservedKey,
  SCHEMA_ARTIFACT_VERSION,
  type SchemaArtifact,
  type Section,
  type TargetKind,
  type VariantSummary,
} from './schemaArtifact.js';
export {
  collectSecretPaths,
  findSecretViolations,
  SECRET_PLACEHOLDER_REGEX,
  type SecretViolation,
} from './secrets.js';

/**
 * Alias kept for the shape called out in the brief: `Rubric` is the
 * fixture's `expect` block.
 */
import type { z } from 'zod';
import type { ExpectSchema } from './fixtureSchema.js';
export type Rubric = z.infer<typeof ExpectSchema>;

// ---- Tier-2 runner surface (Phase 3).

export {
  type AggregateResult,
  aggregate as aggregateRuns,
  type CompositeResult,
  type PromptResultLite,
  weightedComposite,
  wilsonInterval,
} from './runner/aggregate.js';
export { filterArtifactForSkill } from './runner/audienceFilter.js';
export {
  type CliClientOptions,
  type Client,
  createAnthropicClient,
  createCliClient,
  type MessageParams,
  type MessageResult,
} from './runner/client.js';
export {
  type ConversationResult,
  type Followup,
  runConversation,
  type Turn,
} from './runner/conversation.js';
export { extractYaml, extractYamlFromCaptures, looksLikeQuestion } from './runner/extract.js';
export type { CapturedCall } from './runner/mcpStub.js';
export {
  createStubConfig,
  extractCapturedYaml,
  hasSaveCall,
  MCP_STUB_PATH,
  type McpConfig,
  type McpServerConfig,
  readCaptures,
} from './runner/mcpStubLauncher.js';
export { renderHtml, renderJson, renderMarkdown } from './runner/report.js';
export {
  type PromptResult,
  type PromptRun,
  type RunMetadata,
  type RunResults,
  runBench,
  type SummaryMetrics,
  type TierFilter,
} from './runner/run.js';
export {
  buildSystemPromptBlocks,
  loadSkillBundle,
  type SystemBlock,
} from './runner/systemPrompt.js';
