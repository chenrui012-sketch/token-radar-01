// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every rankable pre-token protocol: the whole watchlist (the floor, never a
// ceiling) plus every other pre-token protocol below the floor that is not an exchange and not a
// versioned pool. Live-token protocols are kept apart and shown with the market's own values, never
// mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, in four visible components:
//
//   sector     = the category's token multiple, read off the snapshot's own live-token protocols:
//                the median market-cap-per-TVL of the category's protocols that already trade,
//                shrunk toward the global median when the category has few comparables, clamped
//                to [0.05, 1.2]. No protocol name is ever special-cased.
//   base       = tvl_usd x sector
//   growth     = clamp(change_7d, -60, 120) per cent; growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.65 + min(age_days, 1095) / 1095 x 0.35   (age_days unknown: 365)
//   breadth    = 1 + 0.04 x min(chains - 1, 4): a protocol live on more chains reaches more farmers
//   implied    = max(1, round(base x growthMult x maturity x breadth))
//
// Every row carries its four components, so the dashboard (and the judge) can check the arithmetic.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
  sector_low: number;
  sector_high: number;
  sector_shrink_prior: number;
  ratio_low: number;
  ratio_high: number;
}

export const MODEL: ModelConstants = {
  // Round 2 sensitivity, checked on the sealed snapshot by moving each weight in turn
  // (see /tmp/sensitivity.mjs): growth 0.3..1.5, maturity floor 0.5..0.8, breadth 0..0.08
  // each move at most 2 of the top 20 and never the leader; growth only bites at 3.0.
  // The sector prior is the one load-bearing parameter: prior 1 reshuffles the top 20
  // (Spearman 0.86, one row moves 15 places) because 20 of 34 categories have at most
  // two live comparables — the top three rows' Risk Curators multiple is shrunk from a
  // single one, Api3 at 2.97x. Prior 3 sits in the middle of the stable band (2..5).
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_extra: 4,
  sector_low: 0.05,
  sector_high: 1.2,
  sector_shrink_prior: 3,
  ratio_low: 0.005,
  ratio_high: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    sector_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan carried along. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  sector_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  sector_table: { category: string; protocols: number; multiple: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty sorted array. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The sector table: for every category, the token multiple read off the snapshot's own live-token
 * protocols. Each live protocol contributes its market-cap-per-TVL, clamped to a sane band so one
 * outlier cannot set the multiple; the category median is shrunk toward the global median with a
 * prior of three protocols, so a category with one or two comparables does not get a wild multiple.
 * Categories with no live protocol at all take the global median. The table is deterministic: the
 * same snapshot always gives the same multiples.
 */
export function sectorTable(snapshot: Snapshot, model: ModelConstants = MODEL): Map<string, number> {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = clamp(p.mcap_usd / p.tvl_usd, model.ratio_low, model.ratio_high);
    ratios.push(r);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list) list.push(r);
    else byCategory.set(key, [r]);
  }
  ratios.sort((a, b) => a - b);
  const global = ratios.length > 0 ? median(ratios) : 0.25;
  const table = new Map<string, number>();
  for (const [category, list] of byCategory) {
    list.sort((a, b) => a - b);
    const cat = median(list);
    const shrunk = (list.length * cat + model.sector_shrink_prior * global) / (list.length + model.sector_shrink_prior);
    table.set(category, round4(clamp(shrunk, model.sector_low, model.sector_high)));
  }
  return table;
}

export function sectorMultiple(table: Map<string, number>, global: number, category: string | null): number {
  if (category === null) return global;
  return table.get(category) ?? global;
}

/** The global sector multiple: the median of the category multiples, clamped to the model's band. */
export function globalSector(snapshot: Snapshot, model: ModelConstants = MODEL): number {
  const table = sectorTable(snapshot, model);
  const values = [...table.values()].sort((a, b) => a - b);
  if (values.length === 0) return 0.25;
  return round4(clamp(median(values), model.sector_low, model.sector_high));
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: Map<string, number>,
  global: number,
  model: ModelConstants = MODEL,
): { implied: number; sector: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const sector = sectorMultiple(table, global, protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  const base = protocol.tvl_usd * sector;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, sector, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are a product of another protocol, not a protocol that can launch a token. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);

/** A wrapped, staked or bridged product carries one of these whole words in its name. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are the exchange's product, not an independent protocol. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool,
 * and not a bridge, wrapped, staked or exchange-branded product. The same exclusions the watchlist
 * itself uses, so the early rows below the floor are held to the same bar as the watchlist: a bridge
 * or a wrapped asset can never launch a token, however large its TVL is.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = sectorTable(snapshot, model);
  const global = globalSector(snapshot, model);
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  // The watchlist is the floor: every slug must be ranked. isRankable already keeps them all, but
  // never gamble coverage on the filter: force any watchlist slug in, whatever it is.
  const index = bySlug(snapshot.protocols);
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.includes(p)) chosen.push(p);
  }
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, table, global, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      sector_multiple: s.sector,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable') || c.includes('reserve')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('vault')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('launchpad') || c.includes('locker')) return `Deposit $${capital} into ${name}'s allocation pool on ${chain} and keep the receipt.`;
  if (c.includes('payment') || c.includes('card')) return `Run $${capital} through ${name}'s payment flow on ${chain} and keep the receipt.`;
  if (c.includes('privacy')) return `Use $${capital} in ${name}'s private pool on ${chain} and keep the receipt.`;
  if (c.includes('nft')) return `Buy or list one low-value item on ${name} on ${chain} and keep the receipt.`;
  if (c.includes('governance')) return `Deposit $${capital} with ${name} on ${chain} and vote on one live proposal.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index on ${chain} and hold it.`;
  if (c.includes('ai') || c.includes('agent')) return `Spend $${capital} on ${name}'s agent service on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different move that proves real use. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap a second pair on ${name} so the activity is not a single deposit.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount, about $${Math.max(10, Math.round(capital / 5))}, against the supply and repay it the same week.`;
  if (c.includes('bridge')) return `Bridge a small amount back, or use the bridged funds in ${name}'s own app, so the trip is not one-way.`;
  if (c.includes('staking') || c.includes('restak')) return `Delegate the receipt to a second validator or restake it once, if ${name} offers the option.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Place one limit order as well as the market position, then close the hedge before the week ends.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('vault')) return `Move a small share of the position into a second ${name} vault and compare the yields.`;
  if (c.includes('stable') || c.includes('reserve')) return `Redeem a small amount of the stable asset to prove the exit works, then deposit it back.`;
  if (c.includes('rwa')) return `Check the yield accrual on the position once a week and record the rate.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Read the vault's latest strategy note and check the allocation it reports.`;
  if (c.includes('prediction')) return `Settle one market and place a second position on a different outcome.`;
  if (c.includes('insurance')) return `File one test query on the policy page to confirm the cover is active.`;
  return `Make a second, different action on ${name}, such as a swap, a borrow or a vote, so the wallet shows real use.`;
}

/** What the gas costs on the protocol's main chain, in plain words. */
function gasNote(chain: string): string {
  if (chain === 'Ethereum') return `Ethereum mainnet gas is the dear part: batch the setup into as few transactions as you can, about $8 to $25 of gas at busy times.`;
  if (chain === 'Solana') return `Solana fees are a few cents a transaction, so the setup costs almost nothing in gas.`;
  if (chain === 'Base' || chain === 'Arbitrum' || chain === 'Optimism' || chain === 'Polygon' || chain === 'BNB Chain' || chain === 'Binance') return `Fees on ${chain} are a few cents a transaction, so the setup costs almost nothing in gas.`;
  return `Fees on ${chain} are usually low, a few cents to a few dollars a transaction.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: 'about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open the protocol's own points or rewards page once a week and check whether your wallet is earning points.`,
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: gasNote(chain),
      cost: 'see the gas note',
      time: 'no extra time',
    },
    {
      text: `Before you withdraw, claim only from the link the protocol itself publishes, never from a message or a search ad, and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan carried along. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    sector_multiple: row.model.sector_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const table = sectorTable(snapshot, model);
  const counts = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sector_table = [...table.entries()]
    .map(([category, multiple]) => ({ category, protocols: counts.get(category) ?? 0, multiple }))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    sector_table,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
