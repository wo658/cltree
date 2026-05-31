/**
 * ViewPane registry
 *
 * Registers fetchState (state retrieval) + formatLines (text formatting) per viewType.
 * To add a new GUI pane type, simply register its fetcher here — CLI access is supported automatically.
 */
import type { ViewSlotType } from '../../shared/types';

/** How each viewType exposes its state to the CLI */
export interface ViewPaneFetcher {
  type: ViewSlotType;
  /** Function to fetch the current state. meta is the context saved at view creation time. */
  fetchState(meta: Record<string, unknown>, context: FetchContext): unknown;
  /** Convert to an array of text lines for CLI output */
  formatLines(data: unknown): string[];
}

/** Service context passed to fetchers */
export interface FetchContext {
  sessionId: string;
  /** For calling RepoService.listIssues, etc. */
  repoService?: { listIssues(repo: string): unknown; fetchIssue(repo: string, num: number): unknown };
  /** For calling ConfigService.getAll, etc. */
  configService?: { getAll(): Record<string, unknown> };
}

/** viewType → fetcher mapping */
const registry = new Map<ViewSlotType, ViewPaneFetcher>();

/** Register a fetcher */
export function registerViewPaneFetcher(fetcher: ViewPaneFetcher): void {
  registry.set(fetcher.type, fetcher);
}

/** Look up a fetcher */
export function getViewPaneFetcher(type: ViewSlotType): ViewPaneFetcher | undefined {
  return registry.get(type);
}

/** List all registered viewTypes */
export function getRegisteredViewTypes(): ViewSlotType[] {
  return Array.from(registry.keys());
}
