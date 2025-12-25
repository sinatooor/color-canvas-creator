
export const soundEngine = {
  ctx: null as AudioContext | null,

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  playPop() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Satisfying "Mouth Pop" / "Bubble" effect
    // Starts high and drops pitch rapidly
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.15);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  },

  playDing() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.8);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.8);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.8);
  },

  playBuzz() {
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.linearRampToValueAtTime(80, t + 0.15);

    gain.gain.setValueAtTime(0.1, t);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  },
  
  playCheer() {
     this.init();
     if(!this.ctx) return;
     // Simple major triad arpeggio
     const now = this.ctx.currentTime;
     [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
         const osc = this.ctx!.createOscillator();
         const gain = this.ctx!.createGain();
         osc.type = 'triangle';
         osc.frequency.value = freq;
         gain.gain.setValueAtTime(0.1, now + i*0.1);
         gain.gain.exponentialRampToValueAtTime(0.001, now + i*0.1 + 0.5);
         osc.connect(gain);
         gain.connect(this.ctx!.destination);
         osc.start(now + i*0.1);
         osc.stop(now + i*0.1 + 0.5);
     });
  }
};
