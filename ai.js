(function (root) {
  'use strict';
  const P = root.Poker || require('./engine.js');
  const STYLES = {
    tag: { name: '紧凶', short: '精选起手 · 果断施压', looseness: -.05, aggression: 1.1, bluff: .8, call: -.015, color: '#dda867' },
    lag: { name: '松凶', short: '宽范围 · 高频进攻', looseness: .07, aggression: 1.32, bluff: 1.4, call: .005, color: '#b697e5' },
    balanced: { name: '均衡', short: '混合策略 · 灵活应对', looseness: 0, aggression: 1, bluff: 1, call: 0, color: '#6dc8bc' },
    rock: { name: '稳健', short: '耐心等待 · 重视价值', looseness: -.10, aggression: .72, bluff: .4, call: -.03, color: '#9fbddc' },
    station: { name: '跟注型', short: '偏爱看牌 · 较少诈唬', looseness: .10, aggression: .55, bluff: .28, call: .07, color: '#e69c9c' }
  };
  const LEVELS = {
    easy: { name: '入门', samples: 100, noise: .15, adaptation: .15, range: .35, description: '宽松判断，偶尔犯错，适合熟悉规则。' },
    normal: { name: '标准', samples: 320, noise: .055, adaptation: .45, range: .7, description: '位置意识、胜率估算与基础诈唬。' },
    hard: { name: '进阶', samples: 800, noise: .018, adaptation: .8, range: .9, description: '按行动更新范围，调整下注与防守。' },
    expert: { name: '专家', samples: 1800, noise: 0, adaptation: 1, range: 1, description: '更密集模拟、范围推断和对手适应；非 GTO 求解器。' }
  };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const DIVERSITIES = {
    low: { name: '低', personality: 1, variation: .012, sizing: .06, mix: .02 },
    medium: { name: '中', personality: .55, variation: .055, sizing: .25, mix: .14 },
    high: { name: '高', personality: .12, variation: .14, sizing: .55, mix: .34 }
  };
  const styleKeys = Object.keys(STYLES), diversityKeys = Object.keys(DIVERSITIES);
  const pick = (items, rng) => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
  // Resolve once per table (or when a setting changes), never once per decision.
  // A saved setting stays "random"; the actual draw exists only in the live game.
  function resolveProfile(styleChoice = 'random', diversityChoice = 'random', rng = Math.random, previous) {
    styleChoice = STYLES[styleChoice] ? styleChoice : 'random';
    diversityChoice = DIVERSITIES[diversityChoice] ? diversityChoice : 'random';
    return {
      styleChoice, diversityChoice,
      style: previous?.styleChoice === styleChoice && STYLES[previous.style] ? previous.style : styleChoice === 'random' ? pick(styleKeys, rng) : styleChoice,
      diversity: previous?.diversityChoice === diversityChoice && DIVERSITIES[previous.diversity] ? previous.diversity : diversityChoice === 'random' ? pick(diversityKeys, rng) : diversityChoice
    };
  }
  function decisionStyle(styleId, diversityId = 'low', rng = Math.random) {
    const base = STYLES[styleId] || STYLES.balanced, diversity = DIVERSITIES[diversityId] || DIVERSITIES.low;
    const jitter = () => (rng() * 2 - 1) * diversity.variation;
    return {
      looseness: base.looseness * diversity.personality + jitter(),
      aggression: clamp(1 + (base.aggression - 1) * diversity.personality + jitter() * 3, .35, 1.8),
      bluff: clamp(1 + (base.bluff - 1) * diversity.personality + jitter() * 4, .15, 2),
      call: base.call * diversity.personality + jitter() * .35
    };
  }
  function startingStrength(a, b, variant = 'standard') {
    const r1 = a % 13 + 2, r2 = b % 13 + 2, hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const pair = hi === lo, suited = Math.floor(a / 13) === Math.floor(b / 13), gap = hi - lo;
    if (variant === 'short') {
      if (pair) return 30 + (hi - 6) * 6;
      const distance = hi === 14 && lo <= 9 ? Math.min(gap, lo - 5) : gap;
      return (hi - 6) * 3 + (lo - 6) * 1.8 + (suited ? 8 : 0) + (distance === 1 ? 12 : distance === 2 ? 7 : distance === 3 ? 2 : 0) + (hi === 14 ? 6 : 0);
    }
    if (pair) return 36 + hi * 4.5;
    return hi * 2.2 + lo * 1.25 + (suited ? 4.5 : 0) + (gap === 1 ? 3 : gap === 2 ? 1 : 0) - Math.max(0, gap - 3) * 1.25 + (hi === 14 ? 4 : 0) + (hi === 14 && lo <= 5 && suited ? 3 : 0);
  }
  const rangeModels = {};
  for (const variant of Object.keys(P.VARIANTS)) {
    const deck = P.deckCards(variant), combos = [], percentiles = new Map();
    for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) {
      const a = deck[i], b = deck[j]; combos.push({ a, b, raw: startingStrength(a, b, variant) });
    }
    combos.sort((a, b) => a.raw - b.raw);
    // Equal starting-hand classes receive the same percentile, independent of suit IDs.
    for (let i = 0; i < combos.length;) {
      let end = i + 1; while (end < combos.length && combos[end].raw === combos[i].raw) end++;
      for (let j = i; j < end; j++) {
        const c = combos[j]; c.strength = (i + end) / (2 * combos.length);
        percentiles.set(c.a * 52 + c.b, c.strength);
      }
      i = end;
    }
    rangeModels[variant] = { deck, combos, percentiles };
  }
  function preflop(hole, variant = 'standard') { return rangeModels[variant].percentiles.get(Math.min(...hole) * 52 + Math.max(...hole)) || 0; }
  function features(hole, board, variant = 'standard') {
    if (board.length < 3) return { made: preflop(hole, variant), draw: 0, blocker: hole.some(c => c % 13 === 12) };
    const hand = P.evaluate([...hole, ...board], variant), ranks = hole.map(c => c % 13 + 2), br = board.map(c => c % 13 + 2);
    const boardCounts = {}; br.forEach(r => boardCounts[r] = (boardCounts[r] || 0) + 1);
    const holePair = ranks[0] === ranks[1], hit = ranks.filter(r => br.includes(r));
    const top = Math.max(...br), pairRank = Math.max(...hit, holePair ? ranks[0] : 0);
    let made = (variant === 'short' ? [.10, .28, .50, .68, .81, .97, .91, .99, 1] : [.10, .35, .64, .78, .85, .9, .96, .99, 1])[hand.category];
    if (hand.category === 0) made += Math.max(...ranks) / 140;
    if (hand.category === 1) {
      if (!pairRank) made = .18 + Math.max(...ranks) / 150;
      else made = pairRank > top ? .70 : pairRank === top ? .57 + Math.min(...ranks) / 180 : .32 + pairRank / 100;
    }
    if (hand.category === 2 && Object.values(boardCounts).some(n => n >= 2)) made = pairRank ? .58 : .27;
    if (hand.category === 3 && Object.values(boardCounts).some(n => n === 3)) made = .30;
    if (board.length === 5 && hand.value === P.evaluate(board, variant).value) made = Math.min(made, .30);
    let draw = 0;
    if (board.length < 5) {
      for (let s = 0; s < 4; s++) {
        const n = [...hole, ...board].filter(c => Math.floor(c / 13) === s).length;
        if (n === 4 && hole.some(c => Math.floor(c / 13) === s)) draw += .20;
      }
      const set = new Set([...ranks, ...br]); if (set.has(14)) set.add(variant === 'short' ? 5 : 1);
      let outs = 0;
      for (let high = variant === 'short' ? 9 : 5; high <= 14; high++) {
        const run = Array.from({ length: 5 }, (_, i) => high - i);
        if (run.filter(r => set.has(r)).length === 4 && ranks.some(r => run.includes(r) || (r === 14 && run.includes(variant === 'short' ? 5 : 1)))) outs++;
      }
      if (hand.category < 4) draw += Math.min(.17, outs * .075);
    }
    return { made, draw: Math.min(.32, draw), blocker: ranks.includes(14), category: hand.category };
  }
  function position(obs, id) {
    const live = obs.players.filter(p => p.inHand);
    const ordered = live.slice().sort((a, b) => ((a.id - obs.dealer - 1 + obs.players.length) % obs.players.length) - ((b.id - obs.dealer - 1 + obs.players.length) % obs.players.length));
    return ordered.findIndex(p => p.id === id) / Math.max(1, ordered.length - 1);
  }
  // Build a weighted range from public action history. Style is NOT used to reveal an opponent's hand.
  function buildRange(obs, opponent, known, level) {
    const events = obs.events.filter(e => e.player === opponent.id && e.type === 'action');
    const pf = events.filter(e => e.street === 'preflop');
    const priorVpip = (opponent.stats.vpip + 6) / (opponent.stats.hands + 24);
    const width = clamp(priorVpip, .12, .58), pos = position(obs, opponent.id);
    const later = events.filter(e => e.street !== 'preflop');
    let total = 0; const entries = [];
    for (const c of rangeModels[obs.variant || 'standard'].combos) {
      if (known.has(c.a) || known.has(c.b)) continue;
      let w = 1;
      for (const e of pf) {
        if (e.action === 'raise') {
          const big = e.to > 5 * obs.bigBlind;
          const threshold = big ? .90 : 1 - width - pos * .10;
          w *= .025 + .975 / (1 + Math.exp(-(c.strength - threshold) * (big ? 28 : 19)));
        } else if (e.action === 'call') {
          const threshold = 1 - width - .13 + (e.facing > 4 * obs.bigBlind ? .15 : 0);
          w *= .045 + .955 / (1 + Math.exp(-(c.strength - threshold) * 15));
        }
      }
      for (const e of later) {
        const board = obs.board.slice(0, e.street === 'flop' ? 3 : e.street === 'turn' ? 4 : 5);
        const f = features([c.a, c.b], board, obs.variant), strength = clamp(f.made + f.draw, 0, 1);
        if (e.action === 'raise') {
          const size = e.amount / Math.max(obs.bigBlind, e.potBefore);
          const bluffs = .055 + f.draw * .45 + (f.blocker ? .035 : 0);
          w *= bluffs + 1 / (1 + Math.exp(-(strength - (.52 + Math.min(.18, size * .13))) * 12));
        } else if (e.action === 'call' && e.facing > 0) w *= .09 + .91 / (1 + Math.exp(-(strength - .35) * 10));
        else if (e.action === 'check') w *= strength > .8 ? .7 : 1;
      }
      w = Math.pow(Math.max(.00005, w), level.range);
      total += w; entries.push({ a: c.a, b: c.b, cumulative: total });
    }
    return { entries, total };
  }
  function sampleRange(range, used, rng) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const target = rng() * range.total; let lo = 0, hi = range.entries.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (range.entries[mid].cumulative < target) lo = mid + 1; else hi = mid; }
      const c = range.entries[lo]; if (!used.has(c.a) && !used.has(c.b)) return [c.a, c.b];
    }
    const valid = range.entries.filter(c => !used.has(c.a) && !used.has(c.b));
    let sum = 0;
    for (const c of valid) { const ix = range.entries.indexOf(c); sum += c.cumulative - (ix ? range.entries[ix - 1].cumulative : 0); }
    let target = rng() * sum;
    for (const c of valid) { const ix = range.entries.indexOf(c); target -= c.cumulative - (ix ? range.entries[ix - 1].cumulative : 0); if (target <= 0) return [c.a, c.b]; }
    return [valid[valid.length - 1].a, valid[valid.length - 1].b];
  }
  function estimate(obs, difficulty = 'hard', rng = Math.random, sampleOverride) {
    const level = LEVELS[difficulty], known = new Set([...obs.hole, ...obs.board]);
    const opponents = obs.players.filter(p => p.id !== obs.id && p.inHand && !p.folded);
    if (!opponents.length) return { equity: 1, samples: 0, error: 0 };
    const ranges = opponents.map(p => buildRange(obs, p, known, level));
    // On the river in heads-up pots, enumerate every possible opponent hand.
    // Exact with respect to the inferred range (which is still a model).
    if (obs.board.length === 5 && opponents.length === 1 && ['hard', 'expert'].includes(difficulty)) {
      const hero = P.evaluate([...obs.hole, ...obs.board], obs.variant).value;
      let wonWeight = 0, previous = 0;
      for (const c of ranges[0].entries) {
        const weight = c.cumulative - previous; previous = c.cumulative;
        const villain = P.evaluate([c.a, c.b, ...obs.board], obs.variant).value;
        wonWeight += weight * (hero > villain ? 1 : hero === villain ? .5 : 0);
      }
      return { equity: wonWeight / ranges[0].total, samples: ranges[0].entries.length, error: 0, method: 'enumeration' };
    }
    const n = sampleOverride || level.samples, deck = rangeModels[obs.variant || 'standard'].deck;
    let sum = 0, sq = 0;
    for (let i = 0; i < n; i++) {
      const used = new Set(known), holes = [];
      // Rotate sampling order so collision conditioning doesn't favor a fixed seat.
      for (let j = 0; j < ranges.length; j++) {
        const hole = sampleRange(ranges[(j + i) % ranges.length], used, rng);
        hole.forEach(c => used.add(c)); holes.push(hole);
      }
      const board = [...obs.board];
      while (board.length < 5) { const c = deck[Math.floor(rng() * deck.length)]; if (!used.has(c)) { used.add(c); board.push(c); } }
      const hero = P.evaluate([...obs.hole, ...board], obs.variant).value;
      let ties = 1, lost = false;
      for (const hole of holes) {
        const other = P.evaluate([...hole, ...board], obs.variant).value;
        if (other > hero) { lost = true; break; }
        if (other === hero) ties++;
      }
      const result = lost ? 0 : 1 / ties; sum += result; sq += result * result;
    }
    const equity = sum / n;
    return { equity, samples: n, error: Math.sqrt(Math.max(0, sq / n - equity * equity) / n), method: 'simulation' };
  }
  function decide(obs, difficulty = 'hard', styleId = 'balanced', rng = Math.random, sampleOverride, diversityId = 'low') {
    const level = LEVELS[difficulty] || LEVELS.hard, diversity = DIVERSITIES[diversityId] || DIVERSITIES.low;
    const style = decisionStyle(styleId, diversityId, rng), l = obs.legal;
    const me = obs.players[obs.id], rivals = obs.players.filter(p => p.id !== obs.id && p.inHand && !p.folded);
    const effective = Math.min(me.stack, Math.max(...rivals.map(p => p.stack + p.bet)));
    const estimateResult = estimate(obs, difficulty, rng, sampleOverride);
    let eq = clamp(estimateResult.equity + (rng() - .5) * 2 * level.noise, 0, 1);
    const pos = position(obs, obs.id), f = features(obs.hole, obs.board, obs.variant), pf = preflop(obs.hole, obs.variant);
    const maxContribution = me.total + me.stack;
    // Chips in pots this player cannot win must not inflate their pot odds.
    const eligiblePot = obs.players.reduce((s, p) => s + Math.min(p.total, maxContribution), 0);
    const odds = l.toCall / Math.max(1, eligiblePot + l.toCall);
    const foldRate = rivals.reduce((s, p) => s + (p.stats.foldedToBet + 5) / (p.stats.facedBet + 12), 0) / Math.max(1, rivals.length);
    const callHeavy = rivals.reduce((s, p) => s + (p.stats.calls + 4) / (p.stats.bets + p.stats.calls + 8), 0) / Math.max(1, rivals.length);
    const realization = obs.street === 'river' || !me.stack || l.toCall === me.stack ? 1 : clamp(.82 + pos * .12 - (rivals.length - 1) * .035 + f.draw * .15, .68, 1);
    const adjusted = eq * realization + style.call;
    let type = l.canCheck ? 'check' : 'fold', amount, reason = '保留筹码，等待更有利的机会';
    const raises = obs.events.filter(e => e.type === 'action' && e.street === 'preflop' && e.action === 'raise');
    let valueRaise = false, bluff = false;
    if (obs.street === 'preflop') {
      const unopened = raises.length === 0;
      const threshold = clamp(.85 - pos * .23 - style.looseness + (rivals.length > 3 ? .02 : -.06), .4, .94);
      if (unopened && pf >= threshold) { valueRaise = true; reason = '位置与起手牌范围支持主动入池'; }
      else if (!unopened && pf >= (raises.length > 1 ? .985 : .945) - style.looseness * .2 && eq >= .40) { valueRaise = true; reason = '强起手牌再加注，争取价值与主动权'; }
      if (!valueRaise && !l.canCheck && adjusted > odds + .025 - style.looseness * .12 && (pf > .49 - pos * .13 - style.looseness || l.toCall <= obs.bigBlind)) { type = 'call'; reason = '起手牌与底池赔率允许继续'; }
      // Small blocker-based three-bet bluff component, never random weak-hand shoves.
      bluff = raises.length === 1 && f.blocker && pf > .50 && pf < .88 && rng() < .055 * style.bluff && l.rawCall < me.stack * .12;
    } else {
      if (!l.canCheck && adjusted >= odds + (obs.street === 'river' ? .005 : .02)) { type = 'call'; reason = '范围胜率与底池赔率支持跟注'; }
      const valueThreshold = l.rawCall ? .73 : rivals.length > 2 ? .62 : .58;
      valueRaise = eq > valueThreshold && f.made > .43 && rng() < clamp(.76 * style.aggression + (eq - valueThreshold), .35, .97);
      if (valueRaise) reason = '对估计范围领先，下注获取价值';
      const previousAggressor = obs.events.filter(e => e.type === 'action' && e.action === 'raise').at(-1)?.player;
      const initiative = previousAggressor === obs.id ? 1.18 : 1;
      const adaptation = 1 + (foldRate - .42) * level.adaptation * 2;
      const multiwayPenalty = Math.pow(.38, rivals.length - 1);
      let bluffChance = (f.draw > .12 ? .32 : f.blocker ? .14 : .065) * style.bluff * initiative * adaptation * multiwayPenalty;
      if (callHeavy > .66) bluffChance *= .55;
      if (l.rawCall) bluffChance *= .3;
      bluff = !valueRaise && eq < .48 && rng() < bluffChance && effective > obs.pot * .6;
      if (bluff) reason = f.draw > .12 ? '听牌半诈唬，兼顾弃牌收益和后续改善' : '选择性诈唬，利用位置或关键阻断牌';
    }
    // Vary timing between plausible actions; never fold a free check or invent an illegal raise.
    if (valueRaise && rng() < diversity.mix) {
      if (l.canCheck) { valueRaise = false; type = 'check'; reason = '混合策略：暂缓价值下注，保留后续行动空间'; }
      else if (adjusted >= odds + .025) { valueRaise = false; type = 'call'; reason = '混合策略：以跟注保护继续范围'; }
    }
    if (l.canRaise && (valueRaise || bluff)) {
      const unit = obs.bigBlind;
      let target;
      if (obs.street === 'preflop') {
        const limpers = obs.events.filter(e => e.type === 'action' && e.street === 'preflop' && e.action === 'call').length;
        target = raises.length ? l.currentBet * (pos > .65 ? 3 : 3.6) + limpers * unit : unit * (2.5 + limpers + (pos < .3 ? .5 : 0));
        if (me.stack < 12 * unit && valueRaise && pf > .85) target = l.maxRaiseTo;
      } else {
        const boardSuits = [0, 0, 0, 0]; obs.board.forEach(c => boardSuits[Math.floor(c / 13)]++);
        const wet = Math.max(...boardSuits) >= 2 || f.draw > .1;
        let fraction = wet ? .68 : .45;
        if (eq > .80) fraction = .85;
        if (obs.street === 'river' && (eq > .82 || bluff)) fraction = .85;
        fraction *= .9 + rng() * .2;
        target = l.currentBet + (eligiblePot + l.toCall) * fraction;
        if (l.rawCall > 0) target = Math.max(target, l.currentBet * 2.6);
        if (valueRaise && eq > .72 && me.stack <= (eligiblePot + l.toCall) * 1.35) target = l.maxRaiseTo;
      }
      if (target !== l.maxRaiseTo) target = l.currentBet + (target - l.currentBet) * (1 + (rng() * 2 - 1) * diversity.sizing);
      target = Math.round(target / Math.max(1, unit / 2)) * Math.max(1, unit / 2);
      target = Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, target));
      // Do not turn a tiny mandatory minimum into an expensive weak bluff.
      if (!bluff || target - me.bet < me.stack * .6) { type = 'raise'; amount = target; }
    }
    if (type === 'fold' && l.canCheck) type = 'check';
    if (type === 'check') reason = '控制底池，保留后续决策空间';
    return { type, amount, equity: estimateResult.equity, odds, samples: estimateResult.samples, error: estimateResult.error, method: estimateResult.method, reason };
  }
  const api = { STYLES, LEVELS, DIVERSITIES, resolveProfile, decisionStyle, estimate, decide, features, preflop, startingStrength };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
