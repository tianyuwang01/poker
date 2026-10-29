'use strict';
const assert = require('node:assert/strict');
const P = require('../engine.js');
const AI = require('../ai.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }
function rng(seed = 123) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const parse = str => str.split(' ').map(s => '23456789TJQKA'.indexOf(s[0]) + 'cdhs'.indexOf(s[1]) * 13);
const ev = s => P.evaluate(parse(s));
function make(stacks = [2000, 2000, 2000], random = rng()) { return new P.Game({ players: stacks.map((stack, id) => ({ name: 'P' + id, stack, style: 'balanced' })), rng: random }); }
test('牌型顺序、轮子顺子、踢脚牌、双三条葫芦', () => {
  const hands = ['Ac Jd 9h 6s 3d', 'Ac Ad 9h 6s 3d', 'Ac Ad 9h 9s 3d', 'Ac Ad Ah 6s 3d', 'Ac 2d 3h 4s 5d', 'Ac Jc 9c 6c 3c', 'Ac Ad Ah 6s 6d', 'Ac Ad Ah As 3d', 'Tc Jc Qc Kc Ac'];
  hands.forEach((h, i) => assert.equal(ev(h).category, i));
  for (let i = 1; i < hands.length; i++) assert(ev(hands[i]).value > ev(hands[i - 1]).value);
  assert.equal(ev('Ac Ad Ah Kc Kd Kh 2s').name, '葫芦');
  assert.deepEqual(ev('Ac Ad Ah Kc Kd Kh 2s').kickers, [14, 13]);
  assert.equal(ev('Ac 2d 3h 4s 5d Kc Qh').kickers[0], 5);
  assert(ev('6c 2d 3h 4s 5d Kc Qh').value > ev('Ac 2d 3h 4s 5d Kc Qh').value);
  assert(ev('Ac Ad Kh 6s 3d').value > ev('Ac Ad Qh Js 9d').value);
  assert.equal(ev('Ac Ad Kc Kd Qc Qd 2h').kickers[2], 12);
  assert.equal(ev('2h 4h 6h 8h Th Qh Ah').kickers[0], 14);
});
test('7 张牌直接评估与独立枚举最佳五张一致（2,500 组）', () => {
  const random = rng(66);
  for (let n = 0; n < 2500; n++) {
    const h = P.shuffle(random).slice(0, 7); let best = 0;
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) best = Math.max(best, P.evaluate(h.filter((_, i) => i !== a && i !== b)).value);
    assert.equal(P.evaluate(h).value, best);
  }
});
test('盲注、行动顺序、大盲过牌权、庄家轮转', () => {
  const g = make(); g.start(); assert.equal(g.dealer, 0); assert.equal(g.sb, 1); assert.equal(g.bb, 2); assert.equal(g.actor, 0);
  g.act(0, 'call'); g.act(1, 'call'); assert.equal(g.actor, 2); assert(g.legal().canCheck);
  g.act(2, 'check'); assert.equal(g.street, 'flop'); assert.equal(g.actor, 1);
  while (g.status === 'playing') g.act(g.actor, 'check');
  assert.equal(g.board.length, 5); g.start(); assert.equal(g.dealer, 1);
});
test('单挑庄家小盲先行动，翻牌后大盲先行动', () => {
  const g = make([100, 100]); g.start(); assert.equal(g.sb, g.dealer); assert.equal(g.actor, g.dealer);
  g.act(g.actor, 'call'); g.act(g.actor, 'check'); assert.equal(g.actor, g.bb);
});
test('无效动作不修改状态', () => {
  const g = make(); g.start(); const before = JSON.stringify(g);
  assert.throws(() => g.act(g.actor, 'check')); assert.equal(JSON.stringify(g), before);
  assert.throws(() => g.act(g.actor, 'raise', 25)); assert.equal(JSON.stringify(g), before);
  assert.throws(() => g.act(g.actor, 'raise', NaN)); assert.equal(JSON.stringify(g), before);
  assert.throws(() => g.act(1, 'fold')); assert.equal(JSON.stringify(g), before);
});
test('短码全下不重新开放已行动玩家加注权', () => {
  const g = make([500, 150, 500]); g.start();
  g.act(0, 'raise', 100); g.act(1, 'raise', 150); g.act(2, 'call');
  assert.equal(g.actor, 0); assert.equal(g.legal().rawCall, 50); assert.equal(g.legal().canRaise, false);
  g.act(0, 'call'); assert.equal(g.street, 'flop');
});
test('累计短码全下达到完整加注幅度时重新开放加注权', () => {
  const g = make([500, 150, 200, 500]); g.start();
  g.act(3, 'raise', 100); g.act(0, 'call'); g.act(1, 'raise', 150); g.act(2, 'raise', 200);
  assert.equal(g.actor, 3); assert.equal(g.legal().canRaise, true); assert.equal(g.legal().minRaiseTo, 280);
});
test('三个不同筹码量全下：主池、边池、未跟注金额返回', () => {
  const g = make([300, 100, 200]); g.start();
  g.players[0].hole = parse('Qs Qd'); g.players[1].hole = parse('As Ad'); g.players[2].hole = parse('Ks Kd');
  // Supply a deterministic runout in pop order: burn, flop, burn, turn, burn, river.
  g.deck = parse('9h 8h 7s 6h 4s 3d 2c 5h');
  g.act(0, 'raise', 300); g.act(1, 'call'); g.act(2, 'call');
  assert.equal(g.status, 'complete'); assert.deepEqual(g.players.map(p => p.stack), [100, 300, 200]);
  assert.deepEqual(g.pots.map(p => p.amount), [300, 200, 100]); assert(g.pots[2].refund);
});
test('平分底池的奇数筹码从庄家左边起分配', () => {
  const g = make([100, 100, 100]); g.start();
  g.board = parse('Tc Jc Qc Kc Ac'); g.street = 'river';
  g.players.forEach(p => { p.total = 1; p.bet = 0; p.stack = 99; }); g.players[0].folded = true;
  g.finish(true); assert.deepEqual(g.players.map(p => p.stack), [99, 101, 100]);
});
test('短码大盲和无需行动的全下自动发到河牌', () => {
  const g = make([10, 7]); g.start(); assert.equal(g.status, 'complete'); assert.equal(g.board.length, 5); assert.equal(g.players.reduce((s, p) => s + p.stack, 0), 17);
});
test('盲注全下仍需处理另一位玩家的跟注决定', () => {
  const g = make([100, 20]); g.start(); assert.equal(g.status, 'playing'); assert.equal(g.actor, 0);
  assert.equal(g.legal().canRaise, false); g.act(0, 'call'); assert.equal(g.status, 'complete'); assert.equal(g.board.length, 5);
});
test('短码大盲不足小盲时，覆盖其投入的单挑玩家无需多付或选择弃牌', () => {
  const g = make([100, 7]); g.start(); assert.equal(g.status, 'complete');
  assert.equal(g.board.length, 5); assert.deepEqual(g.pots.map(p => p.amount), [14, 3]);
  assert.equal(g.players.reduce((s, p) => s + p.stack, 0), 107);
});
test('1,200 手随机合法动作：筹码守恒、无重复牌、无死循环', () => {
  const random = rng(1314);
  for (let n = 0; n < 1200; n++) {
    const count = 2 + Math.floor(random() * 5), stacks = Array.from({ length: count }, () => 1 + Math.floor(random() * 1500));
    const g = make(stacks, random), total = stacks.reduce((a, b) => a + b, 0); g.start(); let actions = 0;
    while (g.status === 'playing') {
      assert(++actions < 300); const l = g.legal(); assert(l);
      assert.equal(g.players.reduce((s, p) => s + p.stack + p.total, 0), total);
      assert(g.players.every(p => p.stack >= 0 && p.total >= 0));
      const roll = random();
      if (l.canRaise && roll < .35) {
        const min = Math.min(l.minRaiseTo, l.maxRaiseTo);
        g.act(g.actor, 'raise', min + Math.floor(random() * (l.maxRaiseTo - min + 1)));
      } else if (roll > .8 && !l.canCheck) g.act(g.actor, 'fold');
      else g.act(g.actor, l.canCheck ? 'check' : 'call');
    }
    assert.equal(g.players.reduce((s, p) => s + p.stack, 0), total);
    const dealt = [...g.board, ...g.players.flatMap(p => p.hole)]; assert.equal(new Set(dealt).size, dealt.length);
  }
});
test('AI 观察不含对手底牌或牌堆，隐藏信息变动不影响决策', () => {
  const g = make(); g.start(); const first = g.observation();
  assert(!('deck' in first)); first.players.forEach(p => assert(!('hole' in p)));
  const move = AI.decide(first, 'hard', 'balanced', rng(23), 80);
  g.players[1].hole = parse('Ac Ad'); g.players[2].hole = parse('Kc Kd'); g.deck.reverse();
  assert.deepEqual(g.observation(), first);
  assert.deepEqual(AI.decide(g.observation(), 'hard', 'balanced', rng(23), 80), move);
});
test('胜率估算：坚果牌必胜、公共皇家同花顺平分', () => {
  const g = make(); g.start(); const obs = g.observation();
  obs.street = 'river'; obs.board = parse('Tc Jc Qc 2d 3h'); obs.hole = parse('Kc Ac');
  assert.equal(AI.estimate(obs, 'expert', rng(5), 300).equity, 1);
  obs.board = parse('Tc Jc Qc Kc Ac'); obs.hole = parse('2d 3h');
  assert(Math.abs(AI.estimate(obs, 'expert', rng(5), 300).equity - 1 / 3) < 1e-10);
});
test('四种难度 × 五种打法均返回合法动作', () => {
  for (const level of Object.keys(AI.LEVELS)) for (const style of Object.keys(AI.STYLES)) {
    const g = make([2000, 2000, 2000, 2000, 2000, 2000]); g.start();
    const d = AI.decide(g.observation(), level, style, rng(55), 80); g.act(g.actor, d.type, d.amount);
  }
});
test('进阶/专家单挑河牌遍历所有 990 种合法对手底牌', () => {
  const g = make([2000, 2000]); g.start(); const obs = g.observation();
  obs.street = 'river'; obs.board = parse('Tc Jc Qc 2d 3h'); obs.hole = parse('Kc Ac');
  const d = AI.estimate(obs, 'expert', rng(9));
  assert.equal(d.method, 'enumeration'); assert.equal(d.samples, 990); assert.equal(d.equity, 1); assert.equal(d.error, 0);
});
test('AI 完整对局压力测试：36 手，涵盖全部难度与打法', () => {
  const random = rng(30), levels = Object.keys(AI.LEVELS), styles = Object.keys(AI.STYLES);
  for (let n = 0; n < 36; n++) {
    const g = make(Array(6).fill(1000), random); g.start(); let count = 0;
    while (g.status === 'playing') {
      assert(++count < 250);
      const d = AI.decide(g.observation(), levels[n % 4], styles[g.actor % 5], random, 35);
      assert(Number.isFinite(d.equity)); assert(d.equity >= 0 && d.equity <= 1);
      g.act(g.actor, d.type, d.amount);
    }
    assert.equal(g.players.reduce((s, p) => s + p.stack, 0), 6000);
  }
});
test('专家档默认 1,800 次模拟性能基线', () => {
  const g = make(Array(6).fill(2000)); g.start();
  const start = performance.now(), d = AI.decide(g.observation(), 'expert', 'balanced', rng(22));
  assert.equal(d.samples, 1800); g.act(g.actor, d.type, d.amount);
  console.log('  专家翻牌前决策耗时：' + Math.round(performance.now() - start) + ' ms');
});
test('短牌牌库、A6789、小顺同花顺与牌型顺序', () => {
  const deck = P.shuffle(rng(82), 'short');
  assert.equal(deck.length, 36); assert.equal(new Set(deck).size, 36); assert(deck.every(c => c % 13 >= 4));
  const hands = ['Ac Qd Jh 9s 6d', 'Ac Ad Jh 9s 6d', 'Ac Ad Jh Js 6d', 'Ac Ad Ah 9s 6d', 'Ac 6d 7h 8s 9d', 'Ac Ad Ah 9s 9d', 'Ac Qc Jc 9c 6c', 'Ac Ad Ah As 9d', 'Ac 6c 7c 8c 9c'];
  for (let i = 1; i < hands.length; i++) assert(P.evaluate(parse(hands[i]), 'short').value > P.evaluate(parse(hands[i - 1]), 'short').value);
  assert.equal(P.evaluate(parse(hands[4]), 'short').kickers[0], 9);
  assert.equal(P.evaluate(parse(hands[8]), 'short').name, '同花顺');
  assert.equal(P.evaluate(parse(hands[4])).name, '高牌');
  assert(P.evaluate(parse('6c 7d 8h 9s Td'), 'short').value > P.evaluate(parse(hands[4]), 'short').value);
});
test('短牌 7 张牌与最佳五张枚举一致（1,000 组）', () => {
  const random = rng(83);
  for (let n = 0; n < 1000; n++) {
    const h = P.shuffle(random, 'short').slice(0, 7); let best = 0;
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) best = Math.max(best, P.evaluate(h.filter((_, i) => i !== a && i !== b), 'short').value);
    assert.equal(P.evaluate(h, 'short').value, best);
  }
});
test('相同摊牌：标准牌葫芦胜，短牌同花胜', () => {
  for (const variant of ['standard', 'short']) {
    const g = new P.Game({ variant, players: [{ stack: 200 }, { stack: 200 }], rng: rng() });
    g.start(); g.board = parse('Ac Kc 6c 6d 9s');
    g.players[0].hole = parse('Qc Tc'); g.players[1].hole = parse('6h 9h');
    g.players.forEach(p => { p.stack = 100; p.total = 100; });
    g.finish(true);
    assert.equal(g.players[variant === 'short' ? 0 : 1].stack, 300);
    assert.equal(g.players.reduce((sum, p) => sum + p.stack, 0), 400);
  }
});
test('2–11 人 × 两种模式：完整公共牌、烧牌、轮转与筹码守恒', () => {
  for (const variant of ['standard', 'short']) for (let count = 2; count <= 11; count++) {
    const g = new P.Game({ variant, players: Array.from({ length: count }, () => ({ stack: 1000 })), rng: rng(count) });
    for (let hand = 0; hand < 3; hand++) {
      assert(g.start()); let actions = 0;
      assert.equal(g.observation().variant, variant);
      while (g.status === 'playing') { assert(++actions < 100); g.act(g.actor, g.legal().canCheck ? 'check' : 'call'); }
      assert.equal(g.board.length, 5); assert.equal(g.deck.length, (variant === 'short' ? 36 : 52) - count * 2 - 8);
      const visible = [...g.board, ...g.players.flatMap(p => p.hole)];
      assert.equal(new Set(visible).size, count * 2 + 5);
      assert(visible.every(c => Number.isInteger(c) && c >= 0 && c < 52 && (variant !== 'short' || c % 13 >= 4)));
      assert.equal(g.players.reduce((sum, p) => sum + p.stack, 0), count * 1000);
      assert.equal(g.dealer, hand % count);
    }
  }
});
test('短牌单挑河牌枚举 406 种；模拟不含被移除的低牌', () => {
  const g = new P.Game({ variant: 'short', players: Array.from({ length: 11 }, () => ({ stack: 1000 })), rng: rng(84) });
  g.start(); const obs = g.observation(); obs.board = parse('Tc Jc Qc 6d 8h'); obs.hole = parse('Kc Ac'); obs.street = 'river';
  obs.players.forEach(p => p.folded = p.id !== obs.id && p.id !== (obs.id + 1) % 11);
  const exact = AI.estimate(obs, 'expert', rng(5)); assert.equal(exact.samples, 406); assert.equal(exact.equity, 1);
  obs.board = []; obs.street = 'preflop'; obs.players.forEach(p => p.folded = false);
  const evaluate = P.evaluate; let evaluated = 0;
  try {
    P.evaluate = (cards, variant) => { evaluated++; assert.equal(variant, 'short'); assert(cards.every(c => c % 13 >= 4)); assert.equal(new Set(cards).size, cards.length); return evaluate(cards, variant); };
    const d = AI.estimate(obs, 'expert', rng(6), 100); assert(d.equity >= 0 && d.equity <= 1); assert(evaluated > 100);
  } finally { P.evaluate = evaluate; }
  assert(AI.features(parse('Ac 6d'), parse('7h 8s Qc'), 'short').draw > 0);
  assert.equal(AI.preflop(parse('Ac Kc'), 'short'), AI.preflop(parse('Ah Kh'), 'short'));
});
test('全部人数和模式的 AI 完整对局及隐藏信息边界', () => {
  for (const variant of ['standard', 'short']) for (let count = 2; count <= 11; count++) {
    const random = rng(count + 100), g = new P.Game({ variant, players: Array.from({ length: count }, () => ({ stack: 400, style: 'balanced' })), rng: random });
    g.start(); let steps = 0;
    while (g.status === 'playing') {
      assert(++steps < 300); const obs = g.observation(); assert(!('deck' in obs)); assert(obs.players.every(p => !('hole' in p)));
      const d = AI.decide(obs, Object.keys(AI.LEVELS)[steps % 4], Object.keys(AI.STYLES)[g.actor % 5], random, 20);
      assert(Number.isFinite(d.equity)); g.act(g.actor, d.type, d.amount);
    }
    assert.equal(g.players.reduce((sum, p) => sum + p.stack, 0), count * 400);
  }
});
test('人数与模式边界检查', () => {
  for (const count of [0, 1, 12]) assert.throws(() => new P.Game({ players: Array(count).fill({ stack: 100 }) }));
  assert.throws(() => new P.Game({ variant: 'unknown', players: [{}, {}] }));
});
test('随机性格与随机多样性独立抽取且只在配置改变时重抽', () => {
  const seenStyles = new Set(), seenDiversity = new Set(), combinations = new Set(), random = rng(510);
  for (let i = 0; i < 1500; i++) {
    const profile = AI.resolveProfile('random', 'random', random);
    seenStyles.add(profile.style); seenDiversity.add(profile.diversity); combinations.add(profile.style + ':' + profile.diversity);
    assert.equal(profile.styleChoice, 'random'); assert.equal(profile.diversityChoice, 'random');
    assert.deepEqual(AI.resolveProfile('random', 'random', () => { throw new Error('不应重新抽取'); }, profile), profile);
    const changed = AI.resolveProfile('tag', 'random', random, profile); assert.equal(changed.style, 'tag'); assert.equal(changed.diversity, profile.diversity);
    const changedDiversity = AI.resolveProfile('random', 'high', random, profile); assert.equal(changedDiversity.style, profile.style); assert.equal(changedDiversity.diversity, 'high');
  }
  assert.equal(seenStyles.size, 5); assert.equal(seenDiversity.size, 3); assert.equal(combinations.size, 15);
});
test('高多样性减弱性格差异，同时增加同一性格的决策扰动', () => {
  const lowA = AI.decisionStyle('rock', 'low', rng(20)), lowB = AI.decisionStyle('lag', 'low', rng(20));
  const highA = AI.decisionStyle('rock', 'high', rng(20)), highB = AI.decisionStyle('lag', 'high', rng(20));
  assert(Math.abs(highA.looseness - highB.looseness) < Math.abs(lowA.looseness - lowB.looseness) * .2);
  const variance = level => {
    const random = rng(44), xs = Array.from({ length: 1000 }, () => AI.decisionStyle('balanced', level, random).looseness);
    const mean = xs.reduce((a, b) => a + b) / xs.length; return xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length;
  };
  assert(variance('high') > variance('medium') * 4); assert(variance('medium') > variance('low') * 4);
});
test('多样性改变实际行动和尺寸，不改变胜率模拟精度', () => {
  const g = make([2000, 2000]); g.start(); const obs = g.observation(); obs.hole = parse('Ac Kc');
  const choices = { low: new Set(), high: new Set() };
  for (let seed = 1; seed <= 160; seed++) {
    const low = AI.decide(obs, 'expert', 'balanced', rng(seed), 100, 'low');
    const high = AI.decide(obs, 'expert', 'balanced', rng(seed), 100, 'high');
    assert.equal(low.samples, high.samples); assert.equal(low.equity, high.equity);
    for (const [level, d] of Object.entries({ low, high })) choices[level].add(d.type + ':' + (d.amount || 0));
  }
  assert(choices.high.size > choices.low.size); assert([...choices.high].some(s => s.startsWith('call'))); assert([...choices.high].some(s => s.startsWith('raise')));
});
test('对手观察不泄漏性格、多样性或抽取设置', () => {
  const g = make(); g.start(); const original = g.observation();
  g.players.forEach(p => Object.assign(p, AI.resolveProfile()));
  assert.deepEqual(g.observation(), original);
  assert(g.observation().players.every(p => !('style' in p) && !('diversity' in p) && !('styleChoice' in p)));
});
test('所有难度 × 性格 × 多样性：合法动作；两种牌库完整对局', () => {
  for (const level of Object.keys(AI.LEVELS)) for (const style of Object.keys(AI.STYLES)) for (const diversity of Object.keys(AI.DIVERSITIES)) {
    const g = make(); g.start(); const d = AI.decide(g.observation(), level, style, rng(71), 20, diversity); g.act(g.actor, d.type, d.amount);
  }
  for (const variant of ['standard', 'short']) for (const count of [2, 6, 11]) for (const diversity of Object.keys(AI.DIVERSITIES)) {
    const random = rng(count + 815), g = new P.Game({ variant, players: Array.from({ length: count }, () => ({ stack: 500 })), rng: random });
    g.start(); let actions = 0;
    while (g.status === 'playing') { assert(++actions < 300); const d = AI.decide(g.observation(), 'expert', Object.keys(AI.STYLES)[g.actor % 5], random, 20, diversity); g.act(g.actor, d.type, d.amount); }
    assert.equal(g.players.reduce((sum, p) => sum + p.stack, 0), count * 500);
  }
});
test('强起手牌遇到未重新开放的加注权，按赔率跟注而非错误弃牌', () => {
  const g = make([500, 150, 500], rng(10)); g.start();
  g.act(0, 'raise', 100); g.act(1, 'raise', 150); g.act(2, 'call');
  const obs = g.observation(); obs.hole = parse('Ac Ad');
  assert.equal(obs.legal.canRaise, false);
  const d = AI.decide(obs, 'expert', 'balanced', rng(4), 1800);
  assert(d.equity > .6); assert.equal(d.type, 'call'); g.act(g.actor, d.type, d.amount);
});
test('强起手牌面对覆盖自己筹码的全下可以跟注', () => {
  const g = make([200, 100], rng(12)); g.start(); g.act(g.actor, 'raise', 200);
  const obs = g.observation(); obs.hole = parse('Ac Ad');
  assert.equal(obs.legal.canRaise, false); assert.equal(obs.legal.toCall, obs.players[obs.id].stack);
  const d = AI.decide(obs, 'expert', 'balanced', rng(14), 1800);
  assert.equal(d.type, 'call'); g.act(g.actor, d.type, d.amount); assert.equal(g.status, 'complete');
});
test('小额下注保留有赔率的防守，无胜率的弱牌和昂贵跟注仍可弃牌', () => {
  const g = make([2000, 2000, 2000], rng(10)); g.start();
  g.act(0, 'raise', 60); g.act(1, 'call'); g.act(2, 'call');
  g.act(1, 'raise', 40); g.act(2, 'fold');
  const obs = g.observation(); obs.board = parse('Kh 8s 3d'); obs.hole = parse('Ac 5c');
  const d = AI.decide(obs, 'expert', 'balanced', rng(21), 1800);
  assert(d.equity > d.odds); assert.equal(d.type, 'call');
  obs.hole = parse('7c 2d');
  assert.equal(AI.decide(obs, 'expert', 'balanced', rng(21), 1800).type, 'fold');
  const large = make([2000, 2000, 2000], rng(10)); large.start();
  large.act(0, 'raise', 60); large.act(1, 'call'); large.act(2, 'call');
  large.act(1, 'raise', 360); large.act(2, 'fold');
  const expensive = large.observation(); expensive.board = parse('Kh 8s 3d'); expensive.hole = parse('Ac 5c');
  assert.equal(AI.decide(expensive, 'expert', 'balanced', rng(21), 1800).type, 'fold');
});
(async () => {
  const S = require('../sound.js');
  let created = 0, started = 0, stopped = 0;
  function parameter() { return { setValueAtTime(n, t) { assert(Number.isFinite(n) && Number.isFinite(t)); }, exponentialRampToValueAtTime(n, t) { assert(n > 0 && Number.isFinite(t)); }, cancelScheduledValues() {} }; }
  class AudioContextMock {
    constructor() { created++; this.state = 'suspended'; this.currentTime = 1; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
    createOscillator() { return { frequency: parameter(), connect() {}, disconnect() {}, start() { started++; }, stop() { stopped++; } }; }
  }
  const sound = S.create({ AudioContext: AudioContextMock });
  assert.equal(created, 0); assert.equal(sound.play('deal'), false); await sound.unlock(); assert.equal(created, 1);
  for (const cue of Object.keys(S.CUES)) assert(sound.play(cue)); assert(started > 10);
  sound.setEnabled(false); const mutedStarts = started; assert.equal(sound.play('win'), false); assert(stopped >= started);
  sound.setEnabled(true); sound.setVolume(0); assert.equal(sound.play('chips'), false); assert.equal(started, mutedStarts);
  sound.setVolume(.3); assert(sound.play('check')); await sound.unlock(); assert.equal(created, 1);
  passed++; console.log('✓ 音效按交互初始化、播放所有提示、静音及零音量不播放');
  const unsupported = S.create({ AudioContext: null }); assert.equal(await unsupported.unlock(), false); assert.equal(unsupported.play('deal'), false);
  class FailingContext extends AudioContextMock { resume() { return Promise.reject(new Error('blocked')); } }
  const blocked = S.create({ AudioContext: FailingContext }); assert.equal(await blocked.unlock(), false); assert.equal(blocked.play('chips'), false);
  passed++; console.log('✓ 不支持音频或浏览器拒绝播放时安全降级');
  console.log(`\n${passed} 项测试全部通过。`);
})().catch(error => { console.error(error); process.exitCode = 1; });
