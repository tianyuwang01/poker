(function (root) {
  'use strict';
  // Short, locally synthesized cues. No audio downloads or network requests.
  const CUES = {
    deal: [[900, .035, 0, .22, 300], [1100, .035, .055, .18, 350]],
    chips: [[1550, .055, 0, .16], [2100, .045, .045, .12], [1750, .045, .085, .10]],
    check: [[260, .055, 0, .22, 100]],
    fold: [[500, .055, 0, .14, 110]],
    turn: [[660, .10, 0, .13], [880, .12, .11, .10]],
    finish: [[440, .13, 0, .12], [330, .15, .11, .10]],
    win: [[523, .16, 0, .13], [659, .16, .10, .12], [784, .24, .20, .12]]
  };
  const clamp = n => Math.max(0, Math.min(1, Number(n) || 0));
  function create({ AudioContext = root.AudioContext || root.webkitAudioContext, enabled = true, volume = .35 } = {}) {
    let context, master, failed = false;
    const voices = new Set();
    volume = clamp(volume);
    function stop() {
      for (const voice of voices) { try { voice.stop(); } catch {} }
      voices.clear();
    }
    function updateGain() {
      if (!master) return;
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(enabled ? volume : 0, context.currentTime);
    }
    async function unlock() {
      if (!enabled || !AudioContext || failed) return false;
      try {
        if (!context) {
          context = new AudioContext(); master = context.createGain();
          master.connect(context.destination); updateGain();
        }
        if (context.state !== 'running') await context.resume();
        return context.state === 'running';
      } catch { failed = true; return false; }
    }
    function play(name, delay = 0) {
      if (!enabled || !volume || !context || context.state !== 'running' || !CUES[name]) return false;
      try {
        const start = context.currentTime + Math.max(0, delay);
        for (const [frequency, duration, offset, loudness, endFrequency] of CUES[name]) {
          const oscillator = context.createOscillator(), envelope = context.createGain(), at = start + offset;
          oscillator.type = name === 'check' || name === 'fold' ? 'sine' : 'triangle';
          oscillator.frequency.setValueAtTime(frequency, at);
          if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
          envelope.gain.setValueAtTime(.0001, at);
          envelope.gain.exponentialRampToValueAtTime(loudness, at + .005);
          envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
          oscillator.connect(envelope); envelope.connect(master); voices.add(oscillator);
          oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
          oscillator.start(at); oscillator.stop(at + duration + .01);
        }
        return true;
      } catch { stop(); return false; }
    }
    return {
      unlock, play, stop,
      setEnabled(value) { enabled = Boolean(value); if (!enabled) stop(); updateGain(); },
      setVolume(value) { volume = clamp(value); updateGain(); },
      state() { return { enabled, volume, supported: Boolean(AudioContext) && !failed, ready: context?.state === 'running' }; }
    };
  }
  const api = { create, CUES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PokerSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
