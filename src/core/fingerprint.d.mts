/**
 * fingerprint.mjs 的类型声明
 */

export type Fingerprint = string;

export function fingerprintOf(item: {
  name?: string;
  date?: string;
  status?: string;
}): Fingerprint;

export function toCounts(
  items: { name?: string; date?: string; status?: string }[]
): Record<Fingerprint, number>;

export type NewReason = 'new-count' | 'not-in-baseline';

export interface NewProjectHit<T> {
  item: T;
  reason: NewReason;
}

export function findNewByCounts<T extends { name?: string; date?: string; status?: string }>(
  current: T[],
  seenCounts: Record<Fingerprint, number>
): NewProjectHit<T>[];

export function pruneCounts(
  counts: Record<Fingerprint, number>,
  current: { name?: string; date?: string; status?: string }[]
): Record<Fingerprint, number>;
