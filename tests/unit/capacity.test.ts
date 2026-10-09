import { describe, expect, it } from 'vitest';
import {
  FutureApiCapacityProvider,
  HistoricalCapacityProvider,
  UserConfiguredCapacityProvider,
  defaultCapacityProviders,
  resolveCapacity,
  type CapacityContext,
  type UsageCapacityProvider,
} from '../../src/services/capacity';
import type { WindowBlock } from '../../src/services/aggregation-service';
import { emptyTotals } from '../../src/claude/models';

const block = (counted: number, active = false): WindowBlock => ({ start: 0, end: 1, totals: emptyTotals(), counted, messages: 1, active });
const ctx = (blocks: WindowBlock[], userCapacity = 0): CapacityContext => ({ blocks, now: 0, basis: 'all', userCapacity });

describe('capacity providers', () => {
  it('user-configured returns the setting with high confidence', async () => {
    const p = new UserConfiguredCapacityProvider();
    expect(await p.getCapacity(ctx([], 0))).toBeUndefined();
    expect(await p.getCapacity(ctx([], 5000))).toMatchObject({ tokens: 5000, confidence: 'high', provider: 'user-configured' });
  });

  it('historical needs three completed blocks and ignores the active one', async () => {
    const p = new HistoricalCapacityProvider();
    expect(await p.getCapacity(ctx([block(10), block(20)]))).toBeUndefined();
    const r = await p.getCapacity(ctx([block(10), block(40), block(25), block(9999, true)]));
    expect(r).toMatchObject({ tokens: 40, confidence: 'low', provider: 'historical-peak' });
  });

  it('historical confidence rises with sample size', async () => {
    const blocks = Array.from({ length: 12 }, (_, i) => block(i + 1));
    expect((await new HistoricalCapacityProvider().getCapacity(ctx(blocks)))?.confidence).toBe('medium');
  });

  it('future API provider declines', async () => {
    expect(await new FutureApiCapacityProvider().getCapacity()).toBeUndefined();
  });

  it('resolver prefers the user value, then history, and survives throwing providers', async () => {
    const blocks = [block(10), block(20), block(30)];
    const providers = defaultCapacityProviders();
    expect((await resolveCapacity(providers, ctx(blocks, 777)))?.tokens).toBe(777);
    expect((await resolveCapacity(providers, ctx(blocks)))?.tokens).toBe(30);
    expect(await resolveCapacity(providers, ctx([]))).toBeUndefined();

    const broken: UsageCapacityProvider = { id: 'x', getCapacity: async () => { throw new Error('boom'); } };
    expect((await resolveCapacity([broken, ...providers], ctx(blocks)))?.tokens).toBe(30);
  });
});
