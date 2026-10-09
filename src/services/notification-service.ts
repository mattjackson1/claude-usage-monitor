import type { NotificationState } from '../storage/cache';
import type { Settings } from '../settings/settings';
import type { UsageSnapshot } from './usage-service';

export type NotificationEvent =
  | { kind: 'threshold'; threshold: number; percent: number }
  | { kind: 'reset' };

/**
 * Decides which notifications to show. Mutates `state` (persisted by the
 * caller) so each threshold fires once per rise above it, re-arming when usage
 * falls back below, and the reset fires once when the window empties.
 */
export function evaluateNotifications(
  snapshot: UsageSnapshot,
  settings: Pick<Settings, 'notificationsEnabled' | 'notifyOnWindowReset' | 'warningThresholds'>,
  state: NotificationState,
): NotificationEvent[] {
  const events: NotificationEvent[] = [];
  const pct = snapshot.percentUsed;
  const hasUsage = snapshot.window.messageCount > 0;

  if (pct !== undefined) {
    // Re-arm anything usage has dropped below, regardless of enablement.
    state.fired = state.fired.filter((t) => pct >= t);
    const crossed = settings.warningThresholds.filter((t) => pct >= t && !state.fired.includes(t));
    if (crossed.length > 0) {
      state.fired.push(...crossed);
      // Announce only the highest newly crossed threshold.
      const highest = Math.max(...crossed);
      if (settings.notificationsEnabled) events.push({ kind: 'threshold', threshold: highest, percent: pct });
    }
  }

  if (state.hadUsage && !hasUsage) {
    state.fired = [];
    if (settings.notificationsEnabled && settings.notifyOnWindowReset) events.push({ kind: 'reset' });
  }
  state.hadUsage = hasUsage;
  return events;
}
