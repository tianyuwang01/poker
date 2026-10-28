(function (root) {
  'use strict';
  const SUITS = ['♣', '♦', '♥', '♠'];
  const RANKS = '23456789TJQKA';
  const NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  function card(c) { return { rank: c % 13 + 2, suit: Math.floor(c / 13), text: RANKS[c % 13] + SUITS[Math.floor(c / 13)] }; }
  function score(category, ranks) {
    let value = category;
    for (let i = 0; i < 5; i++) value = value * 15 + (ranks[i] || 0);
    return value;
  }
  function straight(ranks) {
    const set = new Set(ranks);
    if (set.has(14)) set.add(1);
    for (let high = 14; high >= 5; high--) {
      let yes = true;
      for (let j = 0; j < 5; j++) if (!set.has(high - j)) { yes = false; break; }
      if (yes) return high;
    }
    return 0;
  }
  // Direct best-five evaluation of 5–7 cards; no dependencies or lookup downloads.
  function evaluate(cards) {
    if (cards.length < 5 || cards.length > 7) throw new Error('需要 5–7 张牌');
    const counts = Array(15).fill(0), suits = [[], [], [], []];
    for (const c of cards) { const r = c % 13 + 2; counts[r]++; suits[Math.floor(c / 13)].push(r); }
    const ranks = [], groups = [];
    for (let r = 14; r >= 2; r--) if (counts[r]) { ranks.push(r); groups.push([counts[r], r]); }
    groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const flush = suits.find(s => s.length >= 5);
    let category, kickers;
    const sf = flush ? straight(flush) : 0;
    const st = straight(ranks);
    if (sf) { category = 8; kickers = [sf]; }
    else if (groups[0][0] === 4) { category = 7; kickers = [groups[0][1], ranks.find(r => r !== groups[0][1])]; }
    else if (groups[0][0] === 3 && groups[1][0] >= 2) { category = 6; kickers = [groups[0][1], groups[1][1]]; }
    else if (flush) { category = 5; kickers = flush.sort((a, b) => b - a).slice(0, 5); }
    else if (st) { category = 4; kickers = [st]; }
    else if (groups[0][0] === 3) { category = 3; kickers = [groups[0][1], ...ranks.filter(r => r !== groups[0][1]).slice(0, 2)]; }
    else if (groups[0][0] === 2 && groups[1][0] === 2) {
      category = 2; kickers = [groups[0][1], groups[1][1], ranks.find(r => r !== groups[0][1] && r !== groups[1][1])];
    } else if (groups[0][0] === 2) { category = 1; kickers = [groups[0][1], ...ranks.filter(r => r !== groups[0][1]).slice(0, 3)]; }
    else { category = 0; kickers = ranks.slice(0, 5); }
    return { value: score(category, kickers), category, kickers, name: NAMES[category] };
  }
  function shuffle(rng = Math.random) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
  }
  class Game {
    constructor({ players, smallBlind = 10, bigBlind = 20, rng = Math.random }) {
      this.players = players.map((p, i) => ({ ...p, id: i, stack: p.stack ?? 2000, stats: { hands: 0, vpip: 0, raises: 0, decisions: 0, folds: 0, bets: 0, calls: 0, facedBet: 0, foldedToBet: 0 } }));
      this.smallBlind = smallBlind; this.bigBlind = bigBlind; this.rng = rng;
      this.dealer = -1; this.handNumber = 0; this.status = 'idle'; this.actor = -1;
      this.board = []; this.events = []; this.results = []; this.pots = [];
    }
    next(from, predicate) {
      for (let n = 1; n <= this.players.length; n++) { const i = (from + n + this.players.length) % this.players.length; if (predicate(this.players[i])) return i; }
      return -1;
    }
    live() { return this.players.filter(p => p.inHand && !p.folded); }
    actionable() { return this.live().filter(p => p.stack > 0); }
    pot() { return this.players.reduce((s, p) => s + (p.total || 0), 0); }
    log(type, data = {}) { this.events.push({ type, street: this.street, ...data }); }
    start() {
      if (this.status === 'playing') throw new Error('本手尚未结束');
      if (this.players.filter(p => p.stack > 0).length < 2) return false;
      this.handNumber++; this.status = 'playing'; this.street = 'preflop'; this.board = []; this.events = []; this.results = []; this.pots = [];
      this.deck = shuffle(this.rng); this.currentBet = this.bigBlind; this.minRaise = this.bigBlind;
      this.dealer = this.next(this.dealer, p => p.stack > 0);
      for (const p of this.players) {
        Object.assign(p, { inHand: p.stack > 0, folded: false, hole: [], bet: 0, total: 0, lastActedAt: null, action: '', startStack: p.stack, didVpip: false, didRaise: false });
        if (p.inHand) { p.stats.hands++; p.hole = [this.deck.pop(), this.deck.pop()]; }
      }
      const headsUp = this.live().length === 2;
      this.sb = headsUp ? this.dealer : this.next(this.dealer, p => p.inHand);
      this.bb = this.next(this.sb, p => p.inHand);
      this.pay(this.players[this.sb], this.smallBlind); this.players[this.sb].action = '小盲';
      this.pay(this.players[this.bb], this.bigBlind); this.players[this.bb].action = '大盲';
      this.log('blind', { player: this.sb, amount: this.players[this.sb].bet });
      this.log('blind', { player: this.bb, amount: this.players[this.bb].bet });
      this.pending = new Set(this.actionable().map(p => p.id));
      this.advance(this.bb); return true;
    }
    pay(p, amount) { const paid = Math.min(p.stack, amount); p.stack -= paid; p.bet += paid; p.total += paid; return paid; }
    legal(id = this.actor) {
      const p = this.players[id];
      if (!p || this.status !== 'playing' || id !== this.actor) return null;
      const rawCall = Math.max(0, this.currentBet - p.bet);
      const reopened = p.lastActedAt === null || this.currentBet - p.lastActedAt >= this.minRaise;
      const maxRaiseTo = p.bet + p.stack, minRaiseTo = this.currentBet + this.minRaise;
      return { toCall: Math.min(rawCall, p.stack), rawCall, canCheck: rawCall === 0, canRaise: reopened && maxRaiseTo > this.currentBet && this.actionable().some(q => q.id !== id), minRaiseTo, maxRaiseTo, currentBet: this.currentBet, bet: p.bet };
    }
    act(id, type, amount) {
      const legal = this.legal(id); if (!legal) throw new Error('尚未轮到该玩家');
      const p = this.players[id], previous = this.currentBet;
      if (type === 'raise') {
        if (!legal.canRaise || !Number.isInteger(amount) || amount <= previous || amount > legal.maxRaiseTo || (amount < legal.minRaiseTo && amount !== legal.maxRaiseTo)) throw new Error('无效加注额');
      } else if (type === 'check' && !legal.canCheck) throw new Error('需要跟注或弃牌');
      else if (!['fold', 'check', 'call'].includes(type)) throw new Error('未知动作');
      let paid = 0;
      if (type === 'fold') p.folded = true;
      if (type === 'call') paid = this.pay(p, legal.toCall);
      if (type === 'raise') {
        paid = this.pay(p, amount - p.bet); this.currentBet = p.bet;
        const increment = this.currentBet - previous;
        if (increment >= this.minRaise) { this.minRaise = increment; this.pending = new Set(this.actionable().map(q => q.id)); }
        else for (const q of this.actionable()) if (q.bet < this.currentBet) this.pending.add(q.id);
      }
      p.stats.decisions++;
      if (legal.rawCall > 0) { p.stats.facedBet++; if (type === 'fold') p.stats.foldedToBet++; }
      if (type === 'fold') p.stats.folds++;
      if (type === 'raise') p.stats.bets++;
      if (type === 'call' && paid > 0) p.stats.calls++;
      if (this.street === 'preflop' && paid > 0 && !p.didVpip) { p.didVpip = true; p.stats.vpip++; }
      if (this.street === 'preflop' && type === 'raise' && !p.didRaise) { p.didRaise = true; p.stats.raises++; }
      p.lastActedAt = this.currentBet;
      const label = { fold: '弃牌', check: '过牌', call: paid ? '跟注' : '过牌', raise: previous === 0 ? '下注' : '加注' }[type];
      p.action = label + (paid ? ' ' + (type === 'raise' ? p.bet : paid) : '') + (!p.stack && type !== 'fold' ? ' · 全下' : '');
      this.log('action', { player: id, action: type, amount: paid, to: p.bet, potBefore: this.pot() - paid, facing: legal.rawCall, label: p.action });
      this.pending.delete(id); this.advance(id);
    }
    advance(from) {
      if (this.live().length === 1) { this.finish(false); return; }
      for (const id of this.pending) { const p = this.players[id]; if (p.folded || p.stack === 0 || !p.inHand) this.pending.delete(id); }
      const active = this.actionable();
      // A short all-in blind establishes the nominal bring-in only while two
      // players can still bet. With one live stack, only actual chips can be called.
      if (active.length <= 1) this.currentBet = Math.max(...this.live().map(p => p.bet));
      // With no betting opponent, only an outstanding call still needs a decision.
      if (active.length <= 1 && (!active.length || active[0].bet >= this.currentBet)) this.pending.clear();
      if (this.pending.size) { this.actor = this.next(from, p => this.pending.has(p.id)); return; }
      if (this.street === 'river') { this.finish(true); return; }
      this.street = STREETS[STREETS.indexOf(this.street) + 1];
      this.deck.pop(); // Burn one card before each street.
      this.board.push(...Array.from({ length: this.street === 'flop' ? 3 : 1 }, () => this.deck.pop()));
      this.currentBet = 0; this.minRaise = this.bigBlind;
      for (const p of this.players) { p.bet = 0; p.lastActedAt = null; if (!p.folded) p.action = ''; }
      this.log('street', { board: [...this.board] });
      this.pending = new Set(this.actionable().map(p => p.id));
      this.advance(this.dealer);
    }
    finish(showdown) {
      this.status = 'complete'; this.actor = -1; this.showdown = showdown;
      const awards = new Map(), live = this.live();
      const values = new Map(showdown ? live.map(p => [p.id, evaluate([...p.hole, ...this.board])]) : []);
      const levels = [...new Set(this.players.map(p => p.total).filter(Boolean))].sort((a, b) => a - b);
      let previous = 0;
      for (const level of levels) {
        const contributors = this.players.filter(p => p.total >= level);
        const pot = (level - previous) * contributors.length; previous = level;
        const eligible = live.filter(p => p.total >= level);
        let winners;
        if (contributors.length === 1) winners = contributors; // Uncalled excess is returned, even after a fold.
        else if (!showdown) winners = live;
        else {
          const best = Math.max(...eligible.map(p => values.get(p.id).value));
          winners = eligible.filter(p => values.get(p.id).value === best);
        }
        if (!winners.length) throw new Error('边池没有符合资格的玩家');
        winners.sort((a, b) => ((a.id - this.dealer - 1 + this.players.length) % this.players.length) - ((b.id - this.dealer - 1 + this.players.length) % this.players.length));
        const share = Math.floor(pot / winners.length), odd = pot % winners.length;
        winners.forEach((p, i) => awards.set(p.id, (awards.get(p.id) || 0) + share + (i < odd ? 1 : 0)));
        this.pots.push({ amount: pot, winners: winners.map(p => p.id), refund: contributors.length === 1 });
      }
      for (const p of this.players) {
        const won = awards.get(p.id) || 0; p.stack += won;
        if (p.inHand) this.results.push({ id: p.id, won, net: p.stack - p.startStack, hand: values.get(p.id)?.name || '', hole: showdown && !p.folded ? [...p.hole] : [] });
      }
      this.log('finish', { showdown, pot: this.pot(), results: this.results });
    }
    // Deliberately whitelist the AI view. No deck or other players' hole cards.
    observation(id = this.actor) {
      const p = this.players[id];
      return {
        id, hole: [...p.hole], board: [...this.board], street: this.street, pot: this.pot(), dealer: this.dealer, sb: this.sb, bb: this.bb,
        bigBlind: this.bigBlind, handNumber: this.handNumber, legal: this.legal(id),
        players: this.players.map(q => ({ id: q.id, stack: q.stack, bet: q.bet, total: q.total, inHand: q.inHand, folded: q.folded, style: q.style, stats: { ...q.stats } })),
        events: this.events.filter(e => e.type !== 'finish').map(e => ({ ...e, ...(e.board ? { board: [...e.board] } : {}) }))
      };
    }
  }
  const api = { Game, card, evaluate, shuffle, straight, RANKS, SUITS, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Poker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
