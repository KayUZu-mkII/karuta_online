/**
 * KarutaAudio: 日本語読み上げ（Web Speech API）と和風効果音（Web Audio API）
 */
(function (global) {
  class KarutaAudio {
    constructor() {
      this.enabled = true;
      this.ctx = null;
    }

    ensureContext() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    setEnabled(flag) {
      this.enabled = Boolean(flag);
      if (!this.enabled) {
        this.stopSpeech();
      }
    }

    stopSpeech() {
      if ('speechSynthesis' in global) {
        try {
          global.speechSynthesis.cancel();
        } catch (_) {}
      }
    }

    speak(text, rate = 1.0, onEnd = null) {
      if (!this.enabled || !('speechSynthesis' in global)) {
        if (onEnd) setTimeout(onEnd, 1800);
        return;
      }
      this.stopSpeech();
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'ja-JP';
        utter.rate = rate;
        utter.pitch = 1.0;
        const voices = global.speechSynthesis.getVoices();
        const jaVoice = voices.find((v) => v.lang && v.lang.startsWith('ja'));
        if (jaVoice) utter.voice = jaVoice;
        if (onEnd) {
          utter.onend = onEnd;
          utter.onerror = onEnd;
        }
        global.speechSynthesis.speak(utter);
      } catch (_) {
        if (onEnd) setTimeout(onEnd, 1800);
      }
    }

    playHyoshigi() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      [0, 0.16].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1180, ctx.currentTime + offset);
        osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + offset + 0.07);
        gain.gain.setValueAtTime(0.28, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.1);
      });
    }

    playTake() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.11);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.19);
    }

    playMiss() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(190, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(125, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }

    playFanfare() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const t = ctx.currentTime + i * 0.11;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.36);
      });
    }
  }

  global.KarutaAudio = KarutaAudio;
})(window);
