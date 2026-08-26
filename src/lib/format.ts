// ABOUTME: Shared human-readable formatting helpers.
// ABOUTME: formatBytes renders a byte count using binary units (B/KB/MB/GB/TB).

/**
 * Format a byte count into a human-readable string using binary (1024) units.
 * Scales through B, KB, MB, GB, and TB. Negative inputs are treated as 0.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n < 1024 * 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  return `${(n / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
}
