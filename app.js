(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = window.Poker, AI = window.PokerAI;
  const fmt = n => Number(n).toLocaleString('zh-CN');
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + ' ' + fmt(Math.abs(n));
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const streetNames = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌' };
  const botNames = Array.from({ length: 10 }, (_, i) => `AI ${i + 1}`);
  const seatColors = ['#dda867', '#b697e5', '#6dc8bc', '#9fbddc', '#e69c9c', '#c5b86c', '#88b4cf', '#cda7c0', '#9cbf88', '#d9ac8b'];
  let prefs = { difficulty: 'expert', speed: 750, stack: 2000, aiCount: 5, variant: 'standard', profileVersion: 3, diversities: Array(10).fill('random'), sound: true, volume: .35, styles: Array(10).fill('random') };
  let history = [], storageAvailable = true;
  try {
    const stored = JSON.parse((localStorage.getItem('poker-preferences') || localStorage.getItem('night-poker-preferences')) || 'null');
    if (stored) {
      if (AI.LEVELS[stored.difficulty]) prefs.difficulty = stored.difficulty;
      if ([250, 750, 1400].includes(+stored.speed)) prefs.speed = +stored.speed;
      if ([1000, 2000, 4000].includes(+stored.stack)) prefs.stack = +stored.stack;
      if (Number.isInteger(stored.aiCount) && stored.aiCount >= 1 && stored.aiCount <= 10) prefs.aiCount = stored.aiCount;
      if (P.VARIANTS[stored.variant]) prefs.variant = stored.variant;
      if (stored.profileVersion === 3 && Array.isArray(stored.styles)) stored.styles.slice(0, 10).forEach((style, i) => { if (style === 'random' || AI.STYLES[style]) prefs.styles[i] = style; });
      if (Array.isArray(stored.diversities)) stored.diversities.slice(0, 10).forEach((diversity, i) => { if (diversity === 'random' || AI.DIVERSITIES[diversity]) prefs.diversities[i] = diversity; });
      if (typeof stored.sound === 'boolean') prefs.sound = stored.sound;
      if (typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1) prefs.volume = stored.volume;
    }
    const savedHistory = JSON.parse((localStorage.getItem('poker-history') || localStorage.getItem('night-poker-history')) || '[]');
    if (Array.isArray(savedHistory)) history = savedHistory.filter(h => h && Array.isArray(h.events) && Array.isArray(h.decisions) && Array.isArray(h.results)).slice(0, 20);
  } catch { storageAvailable = false; }
  const sound = window.PokerSound.create({ enabled: prefs.sound, volume: prefs.volume });
  let soundEventIndex = 0, turnSoundKey = '';
  let game, timer, toastTimer, generation = 0, paused = false, decisions = [], lastRecorded = 0;
  let completed = 0, wonHands = 0, sessionNet = 0, raiseTo = 0, lastActorKey = '';
  function save() {
    try { localStorage.setItem('poker-preferences', JSON.stringify(prefs)); localStorage.setItem('poker-history', JSON.stringify(history)); }
    catch { if (storageAvailable) toast('浏览器存储不可用，本次仍可正常游玩。'); storageAvailable = false; }
  }
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').hidden = true, 3200);
  }
  function cardHTML(c, hidden = false) {
    if (hidden) return '<div class="card back" aria-label="隐藏底牌"></div>';
    if (c === undefined) return '<div class="card empty" aria-label="尚未发出"></div>';
    const card = P.card(c), rank = card.rank === 10 ? '10' : P.RANKS[c % 13];
    return `<div class="card ${card.suit === 1 || card.suit === 2 ? 'red' : ''}" aria-label="${card.text}"><span class="rank">${rank}</span><span class="suit">${P.SUITS[card.suit]}</span></div>`;
  }
  function cardsText(cards) { return (cards || []).map(c => P.card(c).text).join(' '); }
  function winnerIds() { return new Set(game.pots.filter(p => !p.refund).flatMap(p => p.winners)); }
  function createTable() {
    clearTimeout(timer); sound.stop(); soundEventIndex = 0; turnSoundKey = ''; generation++; paused = false; lastRecorded = 0; lastActorKey = ''; completed = 0; wonHands = 0; sessionNet = 0;
    game = new P.Game({ variant: prefs.variant, players: [{ name: '你', style: 'balanced', stack: prefs.stack }, ...botNames.slice(0, prefs.aiCount).map((name, i) => ({ name, ...AI.resolveProfile(prefs.styles[i], prefs.diversities[i]), stack: prefs.stack }))] });
    $('table-stage').classList.toggle('crowded', game.players.length > 6);
    $('table-size').textContent = `${game.players.length} 人桌`;
    $('variant-label').textContent = prefs.variant === 'short' ? '短牌 · 36 张 · 大小盲' : '标准 · 52 张';
    $('difficulty').value = prefs.difficulty; $('speed').value = prefs.speed; updateDifficulty(); updateSound();
    startHand();
  }
  function startHand() {
    if (game.status === 'playing') return;
    if (game.players[0].stack === 0 || game.players.filter(p => p.stack > 0).length < 2) { showSettings(); return; }
    game.players.slice(1).forEach((p, i) => Object.assign(p, AI.resolveProfile(prefs.styles[i], prefs.diversities[i], Math.random, p)));
    decisions = []; paused = false; lastActorKey = ''; generation++; game.start(); soundEventIndex = game.events.length; turnSoundKey = ''; sound.play('deal'); finishIfNeeded(); render(); schedule();
  }
  function finishIfNeeded() {
    if (game.status !== 'complete' || lastRecorded === game.handNumber) return;
    lastRecorded = game.handNumber; completed++;
    const hero = game.results.find(r => r.id === 0); sessionNet += hero?.net || 0;
    if (winnerIds().has(0)) wonHands++;
    history.unshift({ variant: game.variant, playerCount: game.players.length, hand: game.handNumber, date: new Date().toLocaleString('zh-CN'), difficulty: prefs.difficulty, hero: [...game.players[0].hole], board: [...game.board], pot: game.pot(), net: hero?.net || 0, names: game.players.map(p => p.name), results: game.results.map(r => ({ ...r })), events: game.events.map(e => ({ ...e })), decisions: decisions.map(d => ({ ...d })) });
    history = history.slice(0, 20); save();
  }
  function renderOpponents() {
    $('opponent-list').innerHTML = game.players.slice(1).map(p => {
      const color = seatColors[(p.id - 1) % seatColors.length];
      return `<div class="opponent-row" style="--avatar-color:${color}"><span class="mini-avatar">${p.id}</span><span class="opponent-name">${p.name}<small>${p.stack > 0 ? '观察行动，判断对手' : '筹码归零 · 已离桌'}</small></span></div>`;
    }).join('');
  }
  function renderSeats() {
    const winners = winnerIds();
    const positions = {
      2: [[50, 89], [50, 13]],
      3: [[50, 89], [18, 22], [82, 22]],
      4: [[50, 89], [12, 47], [50, 13], [88, 47]],
      5: [[50, 89], [12, 65], [20, 18], [80, 18], [88, 65]],
      6: [[50, 89], [12, 69], [13, 25], [50, 13], [87, 25], [88, 69]]
    };
    const mobile = {
      2: [[50, 88], [50, 14]],
      3: [[50, 88], [17, 23], [83, 23]],
      4: [[50, 88], [13, 48], [50, 14], [87, 48]],
      5: [[50, 88], [13, 66], [17, 24], [83, 24], [87, 66]],
      6: [[50, 88], [13, 66], [13, 31], [50, 14], [87, 31], [87, 66]]
    };
    $('seats').innerHTML = game.players.map(p => {
      const [x, y] = positions[game.players.length]?.[p.id] || [50, 50];
      const [mx, my] = mobile[game.players.length]?.[p.id] || [50, 50];
      const color = p.id === 0 ? '#dfbb7d' : seatColors[(p.id - 1) % seatColors.length];
      const styleName = p.id === 0 ? 'YOU' : '';
      const show = p.id === 0 || (game.status === 'complete' && game.showdown && !p.folded);
      const marker = p.id === game.dealer ? 'D' : p.id === game.sb ? 'SB' : p.id === game.bb ? 'BB' : '';
      let action = p.action;
      if (game.status === 'complete' && winners.has(p.id)) action = game.results.find(r => r.id === p.id)?.hand || '赢得底池';
      if (p.id === game.actor) action = p.id === 0 ? '轮到你行动' : paused ? '已暂停' : '思考中…';
      if (!p.inHand) action = '已离桌';
      return `<div class="seat seat-${p.id} ${p.folded ? 'folded' : ''} ${!p.inHand ? 'busted' : ''} ${p.id === game.actor ? 'active' : ''} ${winners.has(p.id) ? 'winner' : ''}" style="--avatar-color:${color};--seat-x:${x}%;--seat-y:${y}%;--mobile-x:${mx}%;--mobile-y:${my}%"><div class="seat-portrait">${p.id}</div><div class="seat-info"><div class="seat-name">${p.name}<span class="style-chip">${styleName}</span></div><div class="seat-stack">${fmt(p.stack)}</div>${marker && p.inHand ? `<span class="seat-tag" title="${marker === 'D' ? '庄家按钮' : marker === 'SB' ? '小盲位' : '大盲位'}">${marker}</span>` : ''}</div><div class="seat-cards">${p.hole.map(c => cardHTML(c, !show)).join('')}</div><div class="seat-action">${escape(action || '')}</div>${p.bet && game.status === 'playing' ? `<div class="seat-bet">${fmt(p.bet)}</div>` : ''}</div>`;
    }).join('');
  }
  function eventText(e, names) {
    if (e.type === 'blind') return `${names[e.player]} 投入盲注 ${fmt(e.amount)}`;
    if (e.type === 'action') return `${names[e.player]} ${e.label}`;
    if (e.type === 'street') return `${streetNames[e.street]} · ${cardsText(e.board)}`;
    if (e.type === 'finish') return e.showdown ? '摊牌 · 底池已结算' : '其余玩家弃牌 · 本手结束';
    return '';
  }
  function renderLog() {
    const log = $('hand-log'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 45;
    log.innerHTML = game.events.map(e => `<div class="log-entry ${e.player === 0 ? 'hero' : ''} ${e.type === 'street' || e.type === 'finish' ? 'street' : ''}">${escape(eventText(e, game.players.map(p => p.name)))}</div>`).join('');
    if (atBottom || game.actor === 0) log.scrollTop = log.scrollHeight;
    $('log-street').textContent = streetNames[game.street] || '本手';
  }
  function render() {
    renderOpponents(); renderSeats(); renderLog();
    $('hand-label').textContent = `第 ${String(game.handNumber).padStart(3, '0')} 手`;
    $('hero-stack').textContent = fmt(game.players[0].stack);
    $('session-net').textContent = signed(sessionNet) + ' 本场净值';
    $('session-net').style.color = sessionNet < 0 ? '#e69c9c' : '#90b69a';
    $('played-stat').textContent = completed; $('won-stat').textContent = wonHands;
    const stats = game.players[0].stats;
    $('vpip-stat').textContent = stats.hands ? Math.round(100 * stats.vpip / stats.hands) + '%' : '—';
    $('board').innerHTML = Array.from({ length: 5 }, (_, i) => cardHTML(game.board[i])).join('');
    $('pot-value').textContent = fmt(game.pot()); $('pot-bb').textContent = (game.pot() / game.bigBlind).toFixed(1) + ' BB';
    $('street-label').textContent = game.status === 'complete' ? 'HAND COMPLETE' : `${streetNames[game.street]} · ${game.live().length} 人在局`;
    $('result-banner').hidden = game.status !== 'complete';
    if (game.status === 'complete') {
      const winners = [...winnerIds()].map(id => game.players[id].name);
      $('result-banner').textContent = winners.join('、') + (winners.length > 1 ? ' 分享底池' : ' 赢得底池');
      const hero = game.results.find(r => r.id === 0);
      $('result-summary').innerHTML = `<strong>${hero?.net > 0 ? '漂亮的一手。' : hero?.net === 0 ? '不急，下一手。' : '下一手，新的机会。'}</strong><br><span class="muted">本手 ${signed(hero?.net || 0)}${game.showdown && hero?.hand ? ' · ' + hero.hand : ''}</span>`;
      $('next-hand').textContent = game.players[0].stack === 0 ? '补充筹码 · 新桌 →' : game.players.filter(p => p.stack > 0).length < 2 ? '你赢下了这桌！新桌 →' : '下一手 →';
    }
    renderControls(); syncSounds();
  }
  function renderControls() {
    const mine = game.status === 'playing' && game.actor === 0, done = game.status === 'complete';
    $('between-hands').hidden = !done; $('waiting').hidden = mine || done;
    $('action-buttons').hidden = !mine; $('bet-controls').hidden = !mine;
    if (done) { $('turn-title').textContent = '本手结束'; $('turn-note').textContent = '可在最近牌局查看复盘'; return; }
    if (!mine) {
      $('turn-title').textContent = paused ? '牌桌已暂停' : game.players[0].folded ? '已弃牌 · 观看本手' : '等待对手行动';
      $('turn-note').textContent = AI.LEVELS[prefs.difficulty].name + ' AI';
      $('waiting-text').textContent = paused ? '按继续恢复对局' : `${game.players[game.actor]?.name || '牌桌'}正在思考`;
      $('pause-button').textContent = paused ? '继续' : '暂停'; return;
    }
    const l = game.legal(0), key = game.handNumber + ':' + game.street + ':' + game.events.length;
    if (key !== lastActorKey) { raiseTo = Math.min(l.maxRaiseTo, l.minRaiseTo); lastActorKey = key; }
    $('turn-title').textContent = '轮到你了';
    $('turn-note').textContent = l.toCall ? `跟注 ${fmt(l.toCall)} · 底池赔率 ${Math.round(100 * l.toCall / (game.players.reduce((sum, p) => sum + Math.min(p.total, game.players[0].total + game.players[0].stack), 0) + l.toCall))}%` : '可以免费过牌';
    $('fold-button').disabled = false;
    $('call-button').innerHTML = `${l.canCheck ? '过牌' : (l.toCall === game.players[0].stack ? '跟注全下 ' : '跟注 ') + fmt(l.toCall)} <kbd>C</kbd>`;
    $('call-button').disabled = false;
    $('bet-controls').hidden = !l.canRaise;
    $('raise-button').disabled = !l.canRaise;
    if (l.canRaise) {
      const min = Math.min(l.minRaiseTo, l.maxRaiseTo);
      $('bet-range').min = min; $('bet-range').max = l.maxRaiseTo; $('bet-range').step = 1;
      $('bet-amount').min = min; $('bet-amount').max = l.maxRaiseTo; $('bet-amount').step = 1;
      setRaise(raiseTo);
    } else $('raise-button').innerHTML = '无法加注 <kbd>R</kbd>';
  }
  function setRaise(value) {
    const l = game.legal(0); if (!l?.canRaise) return;
    raiseTo = Math.max(Math.min(l.minRaiseTo, l.maxRaiseTo), Math.min(l.maxRaiseTo, Math.round(Number(value) || l.minRaiseTo)));
    $('bet-range').value = raiseTo; $('bet-amount').value = raiseTo;
    $('raise-button').innerHTML = `${raiseTo === l.maxRaiseTo ? '全下 ' : l.currentBet ? '加注到 ' : '下注 '}${fmt(raiseTo)} <kbd>R</kbd>`;
  }
  function humanAction(type) {
    if (game.actor !== 0 || game.status !== 'playing' || document.querySelector('dialog[open]')) return;
    const l = game.legal(0);
    if (type === 'raise' && !l.canRaise) return;
    if (type === 'call' && l.canCheck) type = 'check';
    try { game.act(0, type, type === 'raise' ? raiseTo : undefined); }
    catch (e) { toast(e.message); return; }
    finishIfNeeded(); render(); schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (paused || document.querySelector('dialog[open]') || game.status !== 'playing' || game.actor === 0) return;
    const token = generation, actor = game.actor;
    timer = setTimeout(() => {
      if (generation !== token || paused || game.actor !== actor || document.querySelector('dialog[open]')) return;
      try {
        const obs = game.observation(actor);
        const decision = AI.decide(obs, prefs.difficulty, game.players[actor].style, Math.random, undefined, game.players[actor].diversity);
        decisions.push({ player: actor, street: game.street, action: decision.type, to: decision.amount, equity: decision.equity, odds: decision.odds, samples: decision.samples, method: decision.method, reason: decision.reason, level: prefs.difficulty });
        game.act(actor, decision.type, decision.amount);
      } catch (e) {
        console.error('AI decision failed', e);
        const l = game.legal(actor); if (l) game.act(actor, l.canCheck ? 'check' : 'fold');
        toast('本次 AI 决策异常，已采用合法的保守动作。');
      }
      finishIfNeeded(); render(); schedule();
    }, prefs.speed);
  }
  function openDialog(id) { clearTimeout(timer); $(id).showModal(); }
  function profileSelectors(target, prefix, count = prefs.aiCount, styles = prefs.styles, diversities = prefs.diversities) {
    $(target).innerHTML = botNames.slice(0, count).map((name, i) => `<fieldset class="ai-profile-settings"><legend>${name}</legend><label for="${prefix}-${i}">性格</label><select id="${prefix}-${i}" aria-label="${name} 性格"><option value="random" ${styles[i] === 'random' ? 'selected' : ''}>随机 · 隐藏性格</option>${Object.entries(AI.STYLES).map(([id, s]) => `<option value="${id}" ${styles[i] === id ? 'selected' : ''}>${s.name} · ${s.short}</option>`).join('')}</select><label for="${prefix}-diversity-${i}">打法多样性</label><select id="${prefix}-diversity-${i}" aria-label="${name} 打法多样性"><option value="random" ${diversities[i] === 'random' ? 'selected' : ''}>随机 · 隐藏档位</option>${[['low', '低 · 性格鲜明'], ['medium', '中 · 更多变化'], ['high', '高 · 弱化性格']].map(([id, label]) => `<option value="${id}" ${diversities[i] === id ? 'selected' : ''}>${label}</option>`).join('')}</select></fieldset>`).join('');
  }
  function readProfiles(target, prefix, styles, diversities) {
    $(target).querySelectorAll('.ai-profile-settings').forEach((_, i) => {
      styles[i] = $(`${prefix}-${i}`).value;
      diversities[i] = $(`${prefix}-diversity-${i}`).value;
    });
  }
  function variantNote() {
    $('variant-description').textContent = $('variant').value === 'short'
      ? '36 张牌（6–A）；同花大于葫芦，顺子大于三条，A6789 为最小顺子。本桌采用大小盲 10 / 20。'
      : '52 张牌；葫芦大于同花，A2345 为最小顺子。大小盲 10 / 20。';
  }
  let draftStyles = [], draftDiversities = [];
  function showSettings() {
    $('starting-stack').value = prefs.stack; $('ai-count').value = prefs.aiCount; $('variant').value = prefs.variant; $('sound-volume').value = Math.round(prefs.volume * 100); $('volume-value').textContent = Math.round(prefs.volume * 100) + '%';
    draftStyles = [...prefs.styles]; draftDiversities = [...prefs.diversities]; profileSelectors('style-settings', 'new-style'); variantNote(); openDialog('settings-dialog');
  }
  $('ai-count').addEventListener('change', () => {
    readProfiles('style-settings', 'new-style', draftStyles, draftDiversities);
    profileSelectors('style-settings', 'new-style', Number($('ai-count').value), draftStyles, draftDiversities);
  });
  $('variant').addEventListener('change', variantNote);
  function updateSound() {
    const state = sound.state();
    $('sound-button').textContent = prefs.sound ? '♪ 音效开' : '♪ 音效关';
    $('sound-button').setAttribute('aria-pressed', String(prefs.sound));
    $('sound-button').setAttribute('aria-label', prefs.sound ? '关闭音效' : '开启音效');
    $('sound-button').title = !state.supported ? '此浏览器不支持音效' : !state.ready && prefs.sound ? '首次点击或按键后开始播放；音量可在新建牌桌中调整' : '点击切换音效；音量可在新建牌桌中调整';
  }
  function syncSounds() {
    const events = game.events.slice(soundEventIndex); soundEventIndex = game.events.length;
    if (document.hidden) { turnSoundKey = ''; return; }
    events.forEach((event, i) => {
      let cue;
      if (event.type === 'action') cue = event.action === 'fold' ? 'fold' : event.amount ? 'chips' : 'check';
      else if (event.type === 'street') cue = 'deal';
      else if (event.type === 'finish') cue = game.results.find(r => r.id === 0)?.net > 0 ? 'win' : 'finish';
      if (cue) sound.play(cue, i * .09);
    });
    const key = game.status === 'playing' && game.actor === 0 ? game.handNumber + ':' + game.events.length : '';
    if (key && key !== turnSoundKey) sound.play('turn', events.length * .09);
    turnSoundKey = key;
  }
  async function unlockSound() { await sound.unlock(); updateSound(); }
  document.addEventListener('pointerdown', unlockSound, { capture: true });
  document.addEventListener('keydown', e => { if (!e.repeat) unlockSound(); }, { capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) sound.stop(); });
  $('sound-button').addEventListener('click', async () => {
    prefs.sound = !prefs.sound; sound.setEnabled(prefs.sound); save();
    if (prefs.sound) { await sound.unlock(); sound.play('check'); }
    updateSound();
    if (prefs.sound && !sound.state().supported) toast('此浏览器无法播放音效，仍可正常游玩。');
  });
  $('sound-volume').addEventListener('input', e => {
    prefs.volume = Number(e.target.value) / 100; sound.setVolume(prefs.volume);
    $('volume-value').textContent = e.target.value + '%'; save();
  });
  $('sound-volume').addEventListener('change', () => sound.play('chips'));
  function updateDifficulty() { $('difficulty-description').textContent = AI.LEVELS[prefs.difficulty].description; }
  $('difficulty').addEventListener('change', e => { prefs.difficulty = e.target.value; updateDifficulty(); save(); renderControls(); schedule(); });
  $('speed').addEventListener('change', e => { prefs.speed = Number(e.target.value); save(); schedule(); });
  $('bet-range').addEventListener('input', e => setRaise(e.target.value));
  $('bet-amount').addEventListener('change', e => setRaise(e.target.value));
  $('bet-amount').addEventListener('input', e => {
    const l = game.legal(0), value = Number(e.target.value);
    if (l && Number.isInteger(value) && value >= Math.min(l.minRaiseTo, l.maxRaiseTo) && value <= l.maxRaiseTo) { raiseTo = value; $('bet-range').value = value; $('raise-button').innerHTML = `${value === l.maxRaiseTo ? '全下 ' : '加注到 '}${fmt(value)} <kbd>R</kbd>`; }
  });
  document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => {
    const l = game.legal(0); if (!l?.canRaise) return;
    const kind = button.dataset.size;
    const value = kind === 'all' ? l.maxRaiseTo : kind === 'min' ? l.minRaiseTo : l.currentBet + Math.round((game.pot() + l.toCall) * ({ half: .5, three: .75, pot: 1 }[kind]));
    setRaise(value);
  }));
  $('fold-button').addEventListener('click', () => humanAction('fold'));
  $('call-button').addEventListener('click', () => humanAction('call'));
  $('raise-button').addEventListener('click', () => { setRaise($('bet-amount').value); humanAction('raise'); });
  $('next-hand').addEventListener('click', startHand);
  $('pause-button').addEventListener('click', () => { paused = !paused; render(); schedule(); });
  $('new-table').addEventListener('click', showSettings);
  $('table-config-button').addEventListener('click', showSettings);
  $('help-button').addEventListener('click', () => openDialog('help-dialog'));
  $('styles-button').addEventListener('click', () => { profileSelectors('live-style-settings', 'live-style'); openDialog('styles-dialog'); });
  $('save-styles').addEventListener('click', () => { readProfiles('live-style-settings', 'live-style', prefs.styles, prefs.diversities); save(); $('styles-dialog').close(); toast('已保存，对手打法从下一手生效。'); });
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault(); prefs.stack = Number($('starting-stack').value); prefs.aiCount = Number($('ai-count').value); prefs.variant = $('variant').value;
    readProfiles('style-settings', 'new-style', draftStyles, draftDiversities); prefs.styles = [...draftStyles]; prefs.diversities = [...draftDiversities]; save(); $('settings-dialog').close(); createTable();
  });
  document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('close', schedule);
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
  });
  $('history-button').addEventListener('click', () => {
    $('history-content').innerHTML = history.length ? history.map(h => `<details class="history-hand"><summary><span>第 ${h.hand} 手 · ${h.variant === 'short' ? '短牌' : '标准牌'} · ${h.playerCount || h.names.length} 人 · ${escape(h.date)} </span><b class="${h.net >= 0 ? 'positive' : 'negative'}">${signed(h.net)}</b><br><span class="muted">你的手牌 ${escape(cardsText(h.hero))}　公共牌 ${escape(cardsText(h.board)) || '未发出'}</span></summary><div class="history-detail"><h4>结算 · 底池 ${fmt(h.pot)}</h4>${h.results.map(r => `<p>${escape(h.names[r.id])} ${signed(r.net)} ${r.hole.length ? ' · ' + escape(cardsText(r.hole)) + ' · ' + escape(r.hand) : ''}</p>`).join('')}<h4>行动记录</h4>${h.events.map(e => `<p>${escape(eventText(e, h.names))}</p>`).join('')}<div class="review"><h4>AI 决策回看</h4>${h.decisions.map(d => `<p><strong>${escape(h.names[d.player])} · ${streetNames[d.street]}</strong> · ${escape(AI.LEVELS[d.level || h.difficulty]?.name || '')} · 估计底池份额 ${Math.round(d.equity * 100)}% · ${d.samples} ${d.method === 'enumeration' ? '种组合枚举' : '次模拟'}<br>${escape(d.reason)}</p>`).join('')}<p class="muted">估计底池份额包含平分情况，依赖对手范围假设。诈唬与价值下注采用混合策略，单手结果不能证明决策优劣。</p></div></div></details>`).join('') : '<div class="no-history">完成第一手后，记录会出现在这里。</div>';
    openDialog('history-dialog');
  });
  document.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === 'f') humanAction('fold');
    else if (key === 'c') humanAction('call');
    else if (key === 'r') humanAction('raise');
    else if (key === 'n' && game.status === 'complete') startHand();
  });
  createTable();
})();
