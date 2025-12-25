/**
 * Lint Rules Export
 *
 * Aggregates all available lint rules.
 */

export { tableNamingRule, columnNamingRule, namingRules } from './naming.js';
export { requirePrimaryKeyRule, preferUuidPkRule, requireTimestampsRule, indexForeignKeysRule, conventionRules } from './conventions.js';
export { noCascadeDeleteRule, requireSoftDeleteRule, securityRules } from './security.js';

import { namingRules } from './naming.js';
import { conventionRules } from './conventions.js';
import { securityRules } from './security.js';
import type { LintRule } from '../types.js';

/**
 * All built-in rules
 */
export const allRules: LintRule[] = [
  ...namingRules,
  ...conventionRules,
  ...securityRules,
];

/**
 * Get rule by name
 */
export function getRuleByName(name: string): LintRule | undefined {
  return allRules.find((rule) => rule.name === name);
}

/**
 * Get all rule names
 */
export function getAllRuleNames(): string[] {
  return allRules.map((rule) => rule.name);
}
