/**
 * Dip-recovery bot for make.fun btc-race-24h-20261123-0511.
 *
 * Strategy (long only, one position, full size):
 *   Entry: the close sits at least 0.8% below its trailing 240-bar high AND
 *   the 9-bar EMA of closes is rising. Buys 100% of cash at the next open.
 *   The dip test is a level that follows the market: the trailing high moves
 *   with price, so the bot only buys a pullback, never a breakout chase.
 *   Exit: take profit at +1.0% over the close of the bar the buy was
 *   decided on, a trailing stop 1.0% below the highest close since entry,
 *   or 360 bars held, whichever comes first. Sells the whole position at
 *   the next open.
 *   Cooldown: 120 bars after every sell fill before the next entry, so a
 *   choppy stretch cannot chain losing round trips.
 *   Loss budget: once cumulative realised PnL over closed round trips falls
 *   to -$8.00 the bot stops trading for the rest of the window. In a falling
 *   market this caps the damage at roughly one bad trade plus the open
 *   position's trailing stop; in a rising market it never binds.
 *
 * Everything is bigint arithmetic on the harness's raw price units, so two
 * runs on the same data produce byte-identical action logs. No clock, no
 * environment, no network, no randomness: the only inputs are the bars and
 * fills the harness sends.
 */
import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (basis points unless noted) ---
const TRAIL_BARS = 240; // trailing-high lookback for the dip test
const DIP_BPS = 80n; // entry needs close <= trail high * (1 - 0.8%)
const TAKE_PROFIT_BPS = 100n; // exit at +1.0% over the entry fill price
const TRAIL_STOP_BPS = 100n; // exit 1.0% below the highest close since entry
const MAX_HOLD_BARS = 360; // exit after 360 bars held
const COOLDOWN_BARS = 120; // bars to wait after a sell fill before re-entering
const LOSS_BUDGET_UNITS = -8_000_000n; // halt when realised PnL <= -$8.00 (micro-USDC)
const MAX_SLIPPAGE_BPS = 200; // generous: 1-minute opens rarely move 2% from the close

/** State for one run. All decisions are pure functions of the bars and fills
 *  seen so far, which is what makes the run deterministic. */
class DipBot {
  private closes: bigint[] = []; // closes seen, raw price units, oldest first
  private lastBarT: number | null = null; // close time of the latest recorded bar
  private ema: bigint | null = null; // 9-bar EMA of closes (integer, same units)
  private prevEma: bigint | null = null; // EMA as it stood before the latest close
  private entryRefClose: bigint | null = null; // close of the bar on which the buy was decided
  private entrySeq: number | null = null; // seq of the bar on which the buy was decided
  private peak: bigint | null = null; // highest close since entry
  private costBasis = 0n; // notional + fees paid for the open position
  private realised = 0n; // cumulative realised PnL, micro-USDC
  private lastSellSeq = -1_000_000_000;
  private halted = false;

  /** Fold this batch's fills into cost basis / realised PnL. */
  private noteFills(state: BarsState, batch: Batch): void {
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      const notional = BigInt(fill.notional_quote_units);
      const fee = BigInt(fill.fee_quote_units);
      if (fill.side === 'buy') {
        // The entry's reference levels come from the decision bar's close
        // (set when the buy was sent), not the fill price: the fill lands
        // ~13 bps above that close (slippage + impact), and measuring the
        // take profit from the fill price would raise the bar past legs the
        // decision-close target catches. Cost basis still uses real fills.
        this.costBasis += notional + fee;
      } else {
        this.realised += (notional - fee) - this.costBasis;
        this.costBasis = 0n;
        this.entryRefClose = null;
        this.entrySeq = null;
        this.peak = null;
        // Cooldown counts from the bar the sell was decided on; the fill is
        // reported one bar later, so subtract one.
        this.lastSellSeq = state.seq - 1;
        if (this.realised <= LOSS_BUDGET_UNITS) this.halted = true;
      }
    }
  }

  /** Record this batch's close and update the EMA, but only when the batch
   *  actually carries a new CBBTC bar: a batch with no bar for the symbol
   *  must not duplicate the previous close. */
  private noteBar(batch: Batch): void {
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      if (bar.t === this.lastBarT) return;
      this.lastBarT = bar.t;
      const close = BigInt(bar.c);
      this.closes.push(close);
      this.prevEma = this.ema;
      // EMA9: k = 2 / (9 + 1); integer arithmetic, exact and repeatable.
      this.ema = this.ema === null ? close : (2n * close + 8n * this.ema) / 10n;
      return;
    }
  }

  /** True when the close is a confirmed dip below its trailing high. */
  private entrySignal(): boolean {
    if (this.closes.length <= TRAIL_BARS) return false;
    if (this.ema === null || this.prevEma === null) return false;
    const close = this.closes[this.closes.length - 1]!;
    const trailHigh = this.closes
      .slice(-TRAIL_BARS - 1, -1)
      .reduce((a, b) => (a > b ? a : b));
    if (close * 10_000n > trailHigh * (10_000n - DIP_BPS)) return false;
    // The short EMA must be rising: the dip is turning, not still falling.
    return this.ema > this.prevEma;
  }

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    this.noteFills(state, batch);
    this.noteBar(batch);
    if (state.warmingUp) return [];
    const holding = state.positions.get(SYMBOL);
    const close = state.close(SYMBOL);
    if (close === null) return [];

    if (holding !== undefined && holding.qty > 0n) {
      // We hold: check the exits against the entry decision bar's close and
      // the peak close since entry.
      if (this.entryRefClose === null || this.peak === null || this.entrySeq === null) {
        // Position without a recorded entry (should not happen); hold it:
        // the trailing stop needs an entry reference.
        return [];
      }
      if (close > this.peak) this.peak = close;
      const heldBars = state.seq - this.entrySeq;
      const takeProfit = close * 10_000n >= this.entryRefClose * (10_000n + TAKE_PROFIT_BPS);
      const stopped = close * 10_000n <= this.peak * (10_000n - TRAIL_STOP_BPS);
      const tooLong = heldBars >= MAX_HOLD_BARS;
      if (takeProfit || stopped || tooLong) {
        return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: maybe enter.
    if (this.halted) return [];
    if (state.seq - this.lastSellSeq < COOLDOWN_BARS) return [];
    if (this.entrySignal() && state.cash > 0n) {
      this.entryRefClose = close;
      this.entrySeq = state.seq;
      this.peak = close;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }
}

const bot = new DipBot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
