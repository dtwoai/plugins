/**
 * Type shim for config-validator.bundle.mjs.
 *
 * Generated artifact — do not edit by hand. Rebuild it from the Dtwo gateway
 * ConfigSchema rather than patching it here.
 */

export const VALIDATOR_BUNDLE_VERSION: string;

export type Config = unknown;

export type SafeParseResult =
  | { success: true; data: Config }
  | { success: false; error: { toString(): string } };

export const ConfigSchema: {
  safeParse(input: unknown): SafeParseResult;
};

export function parseConfig(
  raw: string,
): { success: true; data: Config } | { success: false; error: string };
