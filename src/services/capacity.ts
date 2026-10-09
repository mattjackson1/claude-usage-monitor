import type { TokenBasis } from '../claude/models';
import type { WindowBlock } from './aggregation-service';

export type Confidence = 'high' | 'medium' | 'low';

export interface CapacityContext {
  blocks: readonly WindowBlock[];
  now: number;
  basis: TokenBasis;
  /** claudeUsage.customCapacity; 0 = unset. */
  userCapacity: number;
}

export interface CapacityResult {
  tokens: number;
  provider: string;
  method: string;
  confidence: Confidence;
  note: string;
}

export interface UsageCapacityProvider {
  readonly id: string;
  getCapacity(ctx: CapacityContext): Promise<CapacityResult | undefined>;
}

/** Capacity the user typed into settings. Authoritative but self-reported. */
export class UserConfiguredCapacityProvider implements UsageCapacityProvider {
  readonly id = 'user-configured';

  async getCapacity(ctx: CapacityContext): Promise<CapacityResult | undefined> {
    if (!(ctx.userCapacity > 0)) return undefined;
    return {
      tokens: ctx.userCapacity,
      provider: this.id,
      method: 'claudeUsage.customCapacity setting',
      confidence: 'high',
      note: 'Value supplied by you; accuracy depends on it matching your plan.',
    };
  }
}

/** Estimates capacity as the heaviest completed 5-hour block in local history. */
export class HistoricalCapacityProvider implements UsageCapacityProvider {
  readonly id = 'historical-peak';

  constructor(private readonly minBlocks = 3) {}

  async getCapacity(ctx: CapacityContext): Promise<CapacityResult | undefined> {
    const done = ctx.blocks.filter((b) => !b.active && b.counted > 0);
    if (done.length < this.minBlocks) return undefined;
    const tokens = Math.max(...done.map((b) => b.counted));
    return {
      tokens,
      provider: this.id,
      method: `peak of ${done.length} completed 5-hour blocks`,
      confidence: done.length >= 10 ? 'medium' : 'low',
      note: 'Estimate from your own history, not your plan limit. Set claudeUsage.customCapacity for a fixed value.',
    };
  }
}

/** Placeholder for a future official source of plan limits. Always declines. */
export class FutureApiCapacityProvider implements UsageCapacityProvider {
  readonly id = 'future-api';

  async getCapacity(): Promise<CapacityResult | undefined> {
    return undefined;
  }
}

export async function resolveCapacity(
  providers: readonly UsageCapacityProvider[],
  ctx: CapacityContext,
): Promise<CapacityResult | undefined> {
  for (const p of providers) {
    try {
      const r = await p.getCapacity(ctx);
      if (r && r.tokens > 0) return r;
    } catch {
      // A broken provider must not take the others down.
    }
  }
  return undefined;
}

export function defaultCapacityProviders(): UsageCapacityProvider[] {
  return [new UserConfiguredCapacityProvider(), new FutureApiCapacityProvider(), new HistoricalCapacityProvider()];
}
