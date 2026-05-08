export interface SyncSinceInput {
  lastSyncTs: string | null;
  localVisibleCardCount: number;
  bootstrapComplete: boolean;
}

export function resolveSyncSince(input: SyncSinceInput): string | null {
  if (input.lastSyncTs && input.localVisibleCardCount === 0 && !input.bootstrapComplete) {
    return null;
  }
  return input.lastSyncTs;
}
