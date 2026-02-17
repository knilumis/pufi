(() => {
  "use strict";

  const STORAGE_KEYS = {
    mode: "pufi_focus_mode",
    intensity: "pufi_focus_intensity",
    starSpeed: "pufi_focus_star_speed",
    soundEnabled: "pufi_focus_sound_enabled",
    goals: "pufi_focus_goals",
    timerWorkMinutes: "pufi_focus_timer_work_minutes",
    timerBreakMinutes: "pufi_focus_timer_break_minutes"
  };

  const MODE_PROFILES = {
    ambient: {
      speed: 1,
      particleScale: 1,
      particleOpacity: 0.62,
      meshOpacity: 0.14,
      nebulaStrength: 0.76,
      palette: {
        background: "#070c14",
        nebula: [
          "rgba(68, 99, 136, 0.22)",
          "rgba(45, 72, 108, 0.20)",
          "rgba(34, 50, 76, 0.16)"
        ],
        mesh: "rgba(170, 196, 226, 1)",
        particle: "rgba(197, 219, 246, 1)",
        ripple: "rgba(206, 225, 248, 1)"
      }
    },
    focus: {
      speed: 0.72,
      particleScale: 0.82,
      particleOpacity: 0.52,
      meshOpacity: 0.1,
      nebulaStrength: 0.66,
      palette: {
        background: "#060a11",
        nebula: [
          "rgba(61, 84, 116, 0.18)",
          "rgba(37, 55, 82, 0.17)",
          "rgba(28, 41, 64, 0.14)"
        ],
        mesh: "rgba(145, 170, 202, 1)",
        particle: "rgba(181, 206, 236, 1)",
        ripple: "rgba(189, 213, 243, 1)"
      }
    },
    night: {
      speed: 0.55,
      particleScale: 0.68,
      particleOpacity: 0.46,
      meshOpacity: 0.08,
      nebulaStrength: 0.58,
      palette: {
        background: "#04070d",
        nebula: [
          "rgba(47, 66, 96, 0.15)",
          "rgba(29, 43, 66, 0.14)",
          "rgba(23, 34, 52, 0.12)"
        ],
        mesh: "rgba(121, 143, 169, 1)",
        particle: "rgba(165, 189, 218, 1)",
        ripple: "rgba(173, 197, 224, 1)"
      }
    }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (start, end, amount) => start + (end - start) * amount;

  const debounce = (fn, wait = 180) => {
    let timeoutId = 0;
    return (...args) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => fn(...args), wait);
    };
  };

  class Storage {
    static get(key, fallbackValue) {
      try {
        const rawValue = window.localStorage.getItem(key);
        if (rawValue === null) {
          return fallbackValue;
        }
        return JSON.parse(rawValue);
      } catch (error) {
        return fallbackValue;
      }
    }

    static set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        // Local storage kullanılamazsa sessizce devam et.
      }
    }
  }

  class AudioEngine {
    constructor() {
      this.AudioContextRef = window.AudioContext || window.webkitAudioContext;
      this.available = Boolean(this.AudioContextRef);
      this.ctx = null;
      this.masterGain = null;
      this.ambientGain = null;
      this.enabled = false;
      this.ambientReady = false;
    }

    async ensureContext() {
      if (!this.available) {
        return null;
      }

      try {
        if (!this.ctx) {
          this.ctx = new this.AudioContextRef();
          this.masterGain = this.ctx.createGain();
          this.masterGain.gain.value = 0.9;
          this.masterGain.connect(this.ctx.destination);
        }

        if (this.ctx.state === "suspended") {
          await this.ctx.resume();
        }

        return this.ctx;
      } catch (error) {
        this.available = false;
        this.enabled = false;
        return null;
      }
    }

    createAmbientGraph() {
      if (!this.ctx || !this.masterGain || this.ambientReady) {
        return;
      }

      const mix = this.ctx.createGain();
      mix.gain.value = 0.18;

      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 280;
      lowpass.Q.value = 0.4;

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = 0.0001;

      const oscA = this.ctx.createOscillator();
      oscA.type = "sine";
      oscA.frequency.value = 72;

      const oscB = this.ctx.createOscillator();
      oscB.type = "triangle";
      oscB.frequency.value = 108;
      oscB.detune.value = 4;

      const lfo = this.ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.05;

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 90;

      lfo.connect(lfoGain);
      lfoGain.connect(lowpass.frequency);

      oscA.connect(mix);
      oscB.connect(mix);
      mix.connect(lowpass);
      lowpass.connect(this.ambientGain);
      this.ambientGain.connect(this.masterGain);

      const now = this.ctx.currentTime;
      oscA.start(now);
      oscB.start(now);
      lfo.start(now);

      this.ambientReady = true;
    }

    fadeAmbient(target) {
      if (!this.ctx || !this.ambientGain) {
        return;
      }

      const now = this.ctx.currentTime;
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.linearRampToValueAtTime(target ? 0.045 : 0.0001, now + 0.8);
    }

    async setEnabled(nextState) {
      if (!nextState) {
        this.enabled = false;
        this.fadeAmbient(0);
        return false;
      }

      const ctx = await this.ensureContext();
      if (!ctx) {
        this.enabled = false;
        return false;
      }

      this.createAmbientGraph();
      this.enabled = true;
      this.fadeAmbient(1);
      return true;
    }

    async ping(frequency = 740, duration = 0.16, volume = 0.02) {
      if (!this.enabled) {
        return;
      }

      const ctx = await this.ensureContext();
      if (!ctx || !this.masterGain) {
        return;
      }

      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(180, frequency * 0.65), now + duration);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + duration + 0.03);
      } catch (error) {
        // WebAudio desteklenmiyorsa sessizce devam et.
      }
    }
  }

  class PomodoroTimer {
    constructor({ onTick, onPhaseChange }) {
      this.onTick = onTick;
      this.onPhaseChange = onPhaseChange;
      this.workSeconds = 25 * 60;
      this.breakSeconds = 5 * 60;
      this.phase = "work";
      this.remaining = this.workSeconds;
      this.running = false;
      this.intervalId = 0;
      this.endsAt = 0;
    }

    notify() {
      if (typeof this.onTick === "function") {
        this.onTick(this.remaining, this.phase, this.running);
      }
    }

    start() {
      if (this.running) {
        return;
      }

      this.running = true;
      this.endsAt = Date.now() + this.remaining * 1000;
      this.tick();
      this.intervalId = window.setInterval(() => this.tick(), 250);
      this.notify();
    }

    stop() {
      if (!this.running) {
        return;
      }

      this.tick();
      this.running = false;
      window.clearInterval(this.intervalId);
      this.intervalId = 0;
      this.notify();
    }

    reset() {
      this.stop();
      this.phase = "work";
      this.remaining = this.workSeconds;
      this.notify();
    }

    setDurations(workMinutes, breakMinutes, { resetCurrent = true } = {}) {
      const nextWorkMinutes = clamp(Math.round(Number(workMinutes) || 25), 1, 180);
      const nextBreakMinutes = clamp(Math.round(Number(breakMinutes) || 5), 1, 90);

      this.workSeconds = nextWorkMinutes * 60;
      this.breakSeconds = nextBreakMinutes * 60;

      if (resetCurrent) {
        this.remaining = this.phase === "work" ? this.workSeconds : this.breakSeconds;
        if (this.running) {
          this.endsAt = Date.now() + this.remaining * 1000;
        }
      }

      this.notify();
      return {
        workMinutes: nextWorkMinutes,
        breakMinutes: nextBreakMinutes
      };
    }

    tick() {
      if (!this.running) {
        return;
      }

      const nextRemaining = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
      if (nextRemaining !== this.remaining) {
        this.remaining = nextRemaining;
        this.notify();
      }

      if (this.remaining <= 0) {
        const previousPhase = this.phase;
        this.phase = this.phase === "work" ? "break" : "work";
        this.remaining = this.phase === "work" ? this.workSeconds : this.breakSeconds;
        this.endsAt = Date.now() + this.remaining * 1000;

        if (typeof this.onPhaseChange === "function") {
          this.onPhaseChange(this.phase, previousPhase);
        }

        this.notify();
      }
    }
  }

  class CanvasEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d", { alpha: false });

      this.mode = "ambient";
      this.profile = MODE_PROFILES.ambient;
      this.intensity = 0.65;
      this.starSpeed = 1;

      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = 1;

      this.time = 0;
      this.lastFrame = 0;
      this.frameId = 0;
      this.paused = false;

      this.pointer = {
        x: 0.5,
        y: 0.5,
        targetX: 0.5,
        targetY: 0.5
      };

      this.reducedMotion = false;
      this.motionQuery = null;
      this.motionListener = null;

      this.blobs = [];
      this.particles = [];
      this.ripples = [];
      this.shootingStars = [];
      this.nextShootingAt = 0;

      this.onTap = null;
      this.loop = this.loop.bind(this);

      this.bindMotionPreference();
      this.resize();
      this.rebuildBlobs();
      this.syncParticleCount(true);
      this.scheduleNextShootingStar(performance.now());
      this.render();
    }

    bindMotionPreference() {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.setReducedMotion(this.motionQuery.matches);

      this.motionListener = (event) => this.setReducedMotion(event.matches);
      if (typeof this.motionQuery.addEventListener === "function") {
        this.motionQuery.addEventListener("change", this.motionListener);
      } else if (typeof this.motionQuery.addListener === "function") {
        this.motionQuery.addListener(this.motionListener);
      }
    }

    setReducedMotion(value) {
      this.reducedMotion = Boolean(value);
      this.shootingStars.length = 0;
      this.scheduleNextShootingStar(performance.now());
      this.rebuildBlobs();
      this.syncParticleCount(false);
      this.render();
    }

    setMode(mode) {
      if (!Object.prototype.hasOwnProperty.call(MODE_PROFILES, mode)) {
        return;
      }

      this.mode = mode;
      this.profile = MODE_PROFILES[mode];

      for (const particle of this.particles) {
        const drift = this.randomDrift();
        particle.baseVx = drift.vx;
        particle.baseVy = drift.vy;
      }

      this.rebuildBlobs();
      this.syncParticleCount(false);
      this.render();
    }

    setIntensity(value) {
      const next = clamp(Number(value) || 0.65, 0.2, 1);
      this.intensity = next;
      this.syncParticleCount(false);
      this.render();
    }

    setStarSpeed(value) {
      this.starSpeed = clamp(Number(value) || 1, 0.4, 2.4);
      this.render();
    }

    scheduleNextShootingStar(now = performance.now()) {
      const minDelay = this.reducedMotion ? 15000 : 7800;
      const variance = this.reducedMotion ? 10000 : 7000;
      this.nextShootingAt = now + minDelay + Math.random() * variance;
    }

    spawnShootingStar(now = performance.now()) {
      const startX = Math.random() * this.width * 0.72;
      const startY = Math.random() * this.height * 0.32;
      const angle = Math.PI * (0.12 + Math.random() * 0.24);
      const speedBase = (620 + Math.random() * 360) * (this.reducedMotion ? 0.65 : 1);
      const vx = Math.cos(angle) * speedBase;
      const vy = Math.sin(angle) * speedBase;

      this.shootingStars.push({
        x: startX,
        y: startY,
        vx,
        vy,
        length: 58 + Math.random() * 84,
        thickness: 0.9 + Math.random() * 1.2,
        life: 0,
        ttl: 0.62 + Math.random() * 0.42
      });

      if (this.shootingStars.length > 3) {
        this.shootingStars.shift();
      }

      this.scheduleNextShootingStar(now);
    }

    calculateParticleTarget() {
      const normalized = (this.intensity - 0.2) / 0.8;
      const baseCount = Math.round(120 + normalized * 140);
      const scaledCount = Math.round(baseCount * this.profile.particleScale);

      if (this.reducedMotion) {
        return Math.max(50, Math.round(scaledCount * 0.5));
      }

      return clamp(scaledCount, 120, 260);
    }

    syncParticleCount(forceRebuild = false) {
      const target = this.calculateParticleTarget();

      if (forceRebuild) {
        this.particles = [];
      }

      if (this.particles.length < target) {
        while (this.particles.length < target) {
          this.particles.push(this.spawnParticle());
        }
      } else if (this.particles.length > target) {
        this.particles.length = target;
      }
    }

    randomDrift() {
      const slowFactor = this.reducedMotion ? 0.35 : 1;
      const magnitude = (0.045 + Math.random() * 0.09) * this.profile.speed * slowFactor;
      const angle = Math.random() * Math.PI * 2;
      return {
        vx: Math.cos(angle) * magnitude,
        vy: Math.sin(angle) * magnitude
      };
    }

    spawnParticle() {
      const drift = this.randomDrift();
      return {
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: 0.7 + Math.random() * 1.8,
        alpha: 0.3 + Math.random() * 0.65,
        depth: 0.3 + Math.random() * 0.9,
        baseVx: drift.vx,
        baseVy: drift.vy,
        vx: drift.vx,
        vy: drift.vy
      };
    }

    resize() {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.canvas.width = Math.max(1, Math.floor(this.width * this.dpr));
      this.canvas.height = Math.max(1, Math.floor(this.height * this.dpr));
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      if (!this.particles.length) {
        this.syncParticleCount(true);
      } else {
        for (const particle of this.particles) {
          particle.x = clamp(particle.x, 0, this.width);
          particle.y = clamp(particle.y, 0, this.height);
        }
      }

      this.rebuildBlobs();
      this.render();
    }

    rebuildBlobs() {
      const blobCount = this.reducedMotion ? 3 : 5;
      const baseRadius = Math.min(this.width, this.height) * 0.3;

      this.blobs = Array.from({ length: blobCount }, (_, index) => ({
        baseX: 0.12 + Math.random() * 0.76,
        baseY: 0.12 + Math.random() * 0.76,
        radius: baseRadius * (0.7 + Math.random() * 0.65),
        driftX: this.width * (0.01 + Math.random() * 0.05),
        driftY: this.height * (0.01 + Math.random() * 0.05),
        speed: 0.03 + Math.random() * 0.06,
        phase: Math.random() * Math.PI * 2,
        parallax: 12 + Math.random() * 20,
        colorIndex: index % this.profile.palette.nebula.length
      }));
    }

    start() {
      if (this.frameId) {
        return;
      }

      this.lastFrame = performance.now();
      this.frameId = window.requestAnimationFrame(this.loop);
    }

    loop(timestamp) {
      const dt = Math.min(0.05, (timestamp - this.lastFrame) / 1000 || 0.016);
      this.lastFrame = timestamp;

      this.update(dt);
      this.render();
      this.frameId = window.requestAnimationFrame(this.loop);
    }

    setPaused(value) {
      const next = Boolean(value);
      if (this.paused === next) {
        return;
      }

      this.paused = next;
      if (this.paused) {
        if (this.frameId) {
          window.cancelAnimationFrame(this.frameId);
          this.frameId = 0;
        }
        this.render();
      } else {
        this.start();
      }
    }

    resetMotion() {
      this.ripples.length = 0;
      this.shootingStars.length = 0;
      this.scheduleNextShootingStar(performance.now());
      this.pointer.x = 0.5;
      this.pointer.y = 0.5;
      this.pointer.targetX = 0.5;
      this.pointer.targetY = 0.5;

      for (const particle of this.particles) {
        const drift = this.randomDrift();
        particle.x = Math.random() * this.width;
        particle.y = Math.random() * this.height;
        particle.baseVx = drift.vx;
        particle.baseVy = drift.vy;
        particle.vx = drift.vx;
        particle.vy = drift.vy;
      }

      for (const blob of this.blobs) {
        blob.phase = Math.random() * Math.PI * 2;
      }

      this.render();
    }

    onPointerMove(clientX, clientY) {
      if (!this.width || !this.height) {
        return;
      }

      this.pointer.targetX = clamp(clientX / this.width, 0, 1);
      this.pointer.targetY = clamp(clientY / this.height, 0, 1);
    }

    clickAt(clientX, clientY) {
      const x = clamp(clientX, 0, this.width);
      const y = clamp(clientY, 0, this.height);

      this.ripples.push({
        x,
        y,
        startedAt: performance.now()
      });

      if (this.ripples.length > 12) {
        this.ripples.shift();
      }

      const radius = (105 + this.intensity * 150) * (this.reducedMotion ? 0.55 : 1);
      const pushBase = (0.4 + this.intensity * 0.72) * (this.reducedMotion ? 0.55 : 1);

      for (const particle of this.particles) {
        const dx = particle.x - x;
        const dy = particle.y - y;
        const distance = Math.hypot(dx, dy);

        if (distance > 0 && distance < radius) {
          const power = (1 - distance / radius) * pushBase;
          particle.vx += (dx / distance) * power * 0.28;
          particle.vy += (dy / distance) * power * 0.28;
        }
      }

      if (typeof this.onTap === "function") {
        this.onTap();
      }

      if (this.paused) {
        this.render();
      }
    }

    update(dt) {
      this.time += dt;

      const pointerEase = this.reducedMotion ? 0.03 : 0.08;
      this.pointer.x = lerp(this.pointer.x, this.pointer.targetX, pointerEase);
      this.pointer.y = lerp(this.pointer.y, this.pointer.targetY, pointerEase);

      const motionFactor = this.reducedMotion ? 0.35 : 1;
      const speedFactor = this.profile.speed * (0.62 + this.intensity * 0.95) * motionFactor * this.starSpeed;
      const parallaxStrength = this.reducedMotion ? 0.008 : 0.03;
      const wrapMargin = 24;

      for (const particle of this.particles) {
        particle.vx += (particle.baseVx - particle.vx) * 0.02;
        particle.vy += (particle.baseVy - particle.vy) * 0.02;

        const px = (this.pointer.x - 0.5) * particle.depth * parallaxStrength;
        const py = (this.pointer.y - 0.5) * particle.depth * parallaxStrength;

        particle.x += (particle.vx + px) * dt * 60 * speedFactor;
        particle.y += (particle.vy + py) * dt * 60 * speedFactor;

        if (particle.x < -wrapMargin) particle.x = this.width + wrapMargin;
        if (particle.x > this.width + wrapMargin) particle.x = -wrapMargin;
        if (particle.y < -wrapMargin) particle.y = this.height + wrapMargin;
        if (particle.y > this.height + wrapMargin) particle.y = -wrapMargin;
      }

      const now = performance.now();
      this.ripples = this.ripples.filter((ripple) => now - ripple.startedAt < 1000);

      if (now >= this.nextShootingAt) {
        this.spawnShootingStar(now);
      }

      const shootingScale = this.starSpeed * (this.reducedMotion ? 0.7 : 1.15);
      this.shootingStars = this.shootingStars.filter((star) => {
        star.life += dt;
        star.x += star.vx * dt * shootingScale;
        star.y += star.vy * dt * shootingScale;

        const alive = star.life < star.ttl;
        const onCanvas = star.x < this.width + 180 && star.y < this.height + 180;
        return alive && onCanvas;
      });
    }

    render() {
      const palette = this.profile.palette;
      this.ctx.fillStyle = palette.background;
      this.ctx.fillRect(0, 0, this.width, this.height);

      this.drawNebula();
      this.drawMesh();
      this.drawParticles();
      this.drawShootingStars();
      this.drawRipples();
    }

    drawNebula() {
      const palette = this.profile.palette;
      const driftStrength = this.reducedMotion ? 0.18 : 1;

      this.ctx.save();
      this.ctx.globalCompositeOperation = "lighter";
      this.ctx.globalAlpha = this.profile.nebulaStrength;

      for (const blob of this.blobs) {
        const x =
          blob.baseX * this.width +
          Math.sin(this.time * blob.speed + blob.phase) * blob.driftX * driftStrength +
          (this.pointer.x - 0.5) * blob.parallax;

        const y =
          blob.baseY * this.height +
          Math.cos(this.time * blob.speed * 1.1 + blob.phase) * blob.driftY * driftStrength +
          (this.pointer.y - 0.5) * blob.parallax;

        const radius = blob.radius * (0.92 + Math.sin(this.time * blob.speed * 0.7 + blob.phase) * 0.08 * driftStrength);

        const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, palette.nebula[blob.colorIndex % palette.nebula.length]);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }

      this.ctx.restore();
    }

    drawMesh() {
      const waveAmp = (3 + this.intensity * 6) * (this.reducedMotion ? 0.25 : 1);
      const horizontalRows = 6;
      const verticalCols = 7;
      const xStep = Math.max(56, this.width / 14);
      const yStep = Math.max(58, this.height / 12);

      this.ctx.save();
      this.ctx.strokeStyle = this.profile.palette.mesh;
      this.ctx.lineWidth = 1;
      this.ctx.globalAlpha = this.profile.meshOpacity;

      for (let row = 1; row < horizontalRows; row += 1) {
        const baseY = (row / horizontalRows) * this.height;
        this.ctx.beginPath();

        for (let x = -xStep; x <= this.width + xStep; x += xStep) {
          const wave = Math.sin(x * 0.006 + this.time * 0.5 * this.profile.speed + row) * waveAmp;
          const y = baseY + wave;
          if (x === -xStep) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }

        this.ctx.stroke();
      }

      this.ctx.globalAlpha = this.profile.meshOpacity * 0.55;

      for (let col = 1; col < verticalCols; col += 1) {
        const baseX = (col / verticalCols) * this.width;
        this.ctx.beginPath();

        for (let y = -yStep; y <= this.height + yStep; y += yStep) {
          const wave = Math.sin(y * 0.005 + this.time * 0.45 * this.profile.speed + col * 1.3) * waveAmp * 0.9;
          const x = baseX + wave;
          if (y === -yStep) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        }

        this.ctx.stroke();
      }

      this.ctx.restore();
    }

    drawParticles() {
      const baseOpacity = this.profile.particleOpacity * (0.45 + this.intensity * 0.55);

      this.ctx.save();
      this.ctx.fillStyle = this.profile.palette.particle;

      for (const particle of this.particles) {
        this.ctx.globalAlpha = baseOpacity * particle.alpha;
        this.ctx.beginPath();
        this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    }

    drawShootingStars() {
      if (!this.shootingStars.length) {
        return;
      }

      this.ctx.save();
      this.ctx.globalCompositeOperation = "lighter";

      for (const star of this.shootingStars) {
        const progress = clamp(star.life / star.ttl, 0, 1);
        const alpha = (1 - progress) * (this.reducedMotion ? 0.35 : 0.64);
        const norm = Math.hypot(star.vx, star.vy) || 1;
        const nx = star.vx / norm;
        const ny = star.vy / norm;
        const tailX = star.x - nx * star.length;
        const tailY = star.y - ny * star.length;

        const tail = this.ctx.createLinearGradient(star.x, star.y, tailX, tailY);
        tail.addColorStop(0, `rgba(216, 233, 255, ${alpha})`);
        tail.addColorStop(1, "rgba(216, 233, 255, 0)");

        this.ctx.strokeStyle = tail;
        this.ctx.lineWidth = star.thickness * (1 - progress * 0.45);
        this.ctx.beginPath();
        this.ctx.moveTo(star.x, star.y);
        this.ctx.lineTo(tailX, tailY);
        this.ctx.stroke();

        this.ctx.fillStyle = `rgba(228, 240, 255, ${alpha * 0.9})`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.thickness + 0.3, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    }

    drawRipples() {
      if (!this.ripples.length) {
        return;
      }

      const now = performance.now();
      const rippleDistance = 130 + this.intensity * 80;

      this.ctx.save();
      this.ctx.strokeStyle = this.profile.palette.ripple;

      for (const ripple of this.ripples) {
        const progress = clamp((now - ripple.startedAt) / 1000, 0, 1);
        const radius = 18 + rippleDistance * progress * (this.reducedMotion ? 0.6 : 1);

        this.ctx.globalAlpha = (1 - progress) * 0.45;
        this.ctx.lineWidth = 1.7 - progress * 0.9;
        this.ctx.beginPath();
        this.ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      this.ctx.restore();
    }
  }

  class UIController {
    constructor({ engine, audio }) {
      this.engine = engine;
      this.audio = audio;

      this.elements = {
        intensityInput: document.getElementById("intensity"),
        intensityValue: document.getElementById("intensity-value"),
        starSpeedInput: document.getElementById("star-speed"),
        starSpeedValue: document.getElementById("star-speed-value"),
        soundToggle: document.getElementById("sound-toggle"),
        goalInput: document.getElementById("goal-input"),
        goalAdd: document.getElementById("goal-add"),
        goalList: document.getElementById("goal-list"),
        clock: document.getElementById("clock"),
        date: document.getElementById("date"),
        timerPhase: document.getElementById("timer-phase"),
        timerDisplay: document.getElementById("timer-display"),
        timerWorkInput: document.getElementById("timer-work-min"),
        timerBreakInput: document.getElementById("timer-break-min"),
        timerApply: document.getElementById("timer-apply"),
        centerTimerPhase: document.getElementById("center-timer-phase"),
        centerTimerDisplay: document.getElementById("center-timer-display"),
        timerStart: document.getElementById("timer-start"),
        timerStop: document.getElementById("timer-stop"),
        timerReset: document.getElementById("timer-reset")
      };

      this.modeButtons = Array.from(document.querySelectorAll(".mode-btn"));
      this.groupToggles = Array.from(document.querySelectorAll(".group-toggle"));
      this.resizeHandler = debounce(() => this.engine.resize(), 180);
      this.goals = [];

      this.timer = new PomodoroTimer({
        onTick: (remaining, phase, running) => this.renderTimer(remaining, phase, running),
        onPhaseChange: () => this.audio.ping(880, 0.24, 0.028)
      });
    }

    normalizeGoalEntry(entry) {
      if (typeof entry === "string") {
        const textValue = entry.trim();
        return textValue ? { text: textValue, done: false } : null;
      }

      if (!entry || typeof entry !== "object") {
        return null;
      }

      const textValue = typeof entry.text === "string" ? entry.text.trim() : "";
      if (!textValue) {
        return null;
      }

      return {
        text: textValue,
        done: Boolean(entry.done)
      };
    }

    init() {
      const savedMode = Storage.get(STORAGE_KEYS.mode, "ambient");
      const savedIntensity = Storage.get(STORAGE_KEYS.intensity, 0.65);
      const savedStarSpeed = Storage.get(STORAGE_KEYS.starSpeed, 1);
      const savedGoals = Storage.get(STORAGE_KEYS.goals, []);
      const savedSound = Storage.get(STORAGE_KEYS.soundEnabled, false);
      const savedTimerWork = Storage.get(STORAGE_KEYS.timerWorkMinutes, 25);
      const savedTimerBreak = Storage.get(STORAGE_KEYS.timerBreakMinutes, 5);

      this.goals = Array.isArray(savedGoals)
        ? savedGoals
            .map((entry) => this.normalizeGoalEntry(entry))
            .filter((entry) => entry !== null)
            .slice(0, 20)
        : [];

      this.setMode(savedMode, false);
      this.setIntensity(savedIntensity, false);
      this.setStarSpeed(savedStarSpeed, false);
      this.applyTimerDurations(savedTimerWork, savedTimerBreak, false);
      this.renderGoals();
      this.renderSound(false);

      this.updateClock();
      window.setInterval(() => this.updateClock(), 1000);

      this.bindEvents();
      this.engine.start();

      if (savedSound) {
        this.toggleSound(true, false);
      }

      this.engine.onTap = () => {
        this.audio.ping(720, 0.14, 0.018);
      };
    }

    bindEvents() {
      for (const toggleButton of this.groupToggles) {
        toggleButton.addEventListener("click", () => this.toggleGroup(toggleButton));
      }

      for (const button of this.modeButtons) {
        button.addEventListener("click", () => {
          this.setMode(button.dataset.mode, true);
        });
      }

      this.elements.intensityInput.addEventListener("input", (event) => {
        this.setIntensity(event.target.value, true);
      });

      this.elements.starSpeedInput.addEventListener("input", (event) => {
        this.setStarSpeed(event.target.value, true);
      });

      this.elements.soundToggle.addEventListener("click", async () => {
        await this.toggleSound(!this.audio.enabled, true);
      });

      this.elements.goalAdd.addEventListener("click", () => {
        this.addGoalFromInput();
      });

      this.elements.goalInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.addGoalFromInput();
        }
      });

      this.elements.goalList.addEventListener("click", (event) => {
        const actionButton = event.target.closest("button[data-action][data-index]");
        if (!actionButton) {
          return;
        }

        const index = Number(actionButton.dataset.index);
        if (!Number.isInteger(index)) {
          return;
        }

        const action = actionButton.dataset.action;
        if (action === "toggle") {
          this.toggleGoalDone(index);
          return;
        }

        if (action === "remove") {
          this.removeGoal(index);
        }
      });

      this.elements.timerApply.addEventListener("click", () => {
        this.applyTimerFromInputs(true);
      });

      for (const timerInput of [this.elements.timerWorkInput, this.elements.timerBreakInput]) {
        timerInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.applyTimerFromInputs(true);
          }
        });
      }

      this.elements.timerStart.addEventListener("click", () => this.timer.start());
      this.elements.timerStop.addEventListener("click", () => this.timer.stop());
      this.elements.timerReset.addEventListener("click", () => this.timer.reset());

      this.engine.canvas.addEventListener(
        "pointerdown",
        (event) => {
          this.engine.clickAt(event.clientX, event.clientY);
        },
        { passive: true }
      );

      window.addEventListener(
        "pointermove",
        (event) => {
          this.engine.onPointerMove(event.clientX, event.clientY);
        },
        { passive: true }
      );

      window.addEventListener("pointerleave", () => {
        this.engine.onPointerMove(this.engine.width * 0.5, this.engine.height * 0.5);
      });

      window.addEventListener("resize", this.resizeHandler, { passive: true });
      window.addEventListener("keydown", (event) => this.handleShortcuts(event));
    }

    handleShortcuts(event) {
      const active = document.activeElement;
      const isTyping =
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);

      if (isTyping) {
        return;
      }

      const key = event.key.toLowerCase();

      if (event.code === "Space") {
        event.preventDefault();
        this.togglePause();
        return;
      }

      if (key === "f") {
        this.setMode("focus", true);
        return;
      }

      if (key === "a") {
        this.setMode("ambient", true);
        return;
      }

      if (key === "n") {
        this.setMode("night", true);
        return;
      }

      if (key === "r") {
        this.engine.resetMotion();
      }
    }

    togglePause() {
      const nextPaused = !this.engine.paused;
      this.engine.setPaused(nextPaused);
    }

    toggleGroup(toggleButton) {
      const targetId = toggleButton.dataset.groupTarget;
      if (!targetId) {
        return;
      }

      const targetElement = document.getElementById(targetId);
      if (!targetElement) {
        return;
      }

      const isExpanded = toggleButton.getAttribute("aria-expanded") === "true";
      const nextExpanded = !isExpanded;
      this.setGroupState(toggleButton, targetElement, nextExpanded);
    }

    setGroupState(toggleButton, targetElement, expanded) {
      toggleButton.setAttribute("aria-expanded", String(expanded));
      targetElement.hidden = !expanded;

      const indicator = toggleButton.querySelector(".group-indicator");
      if (indicator) {
        indicator.textContent = expanded ? "−" : "+";
      }
    }

    setMode(mode, persist) {
      const nextMode = Object.prototype.hasOwnProperty.call(MODE_PROFILES, mode) ? mode : "ambient";

      document.body.dataset.mode = nextMode;
      this.engine.setMode(nextMode);

      for (const button of this.modeButtons) {
        const isActive = button.dataset.mode === nextMode;
        button.classList.toggle("is-active", isActive);
      }

      if (persist) {
        Storage.set(STORAGE_KEYS.mode, nextMode);
      }
    }

    setIntensity(value, persist) {
      const normalized = clamp(Number(value) || 0.65, 0.2, 1);
      this.elements.intensityInput.value = normalized.toFixed(2);
      this.elements.intensityValue.textContent = `${Math.round(normalized * 100)}%`;

      this.engine.setIntensity(normalized);

      if (persist) {
        Storage.set(STORAGE_KEYS.intensity, normalized);
      }
    }

    setStarSpeed(value, persist) {
      const normalized = clamp(Number(value) || 1, 0.4, 2.4);
      this.elements.starSpeedInput.value = normalized.toFixed(1);
      this.elements.starSpeedValue.textContent = `${normalized.toFixed(1)}x`;

      this.engine.setStarSpeed(normalized);

      if (persist) {
        Storage.set(STORAGE_KEYS.starSpeed, normalized);
      }
    }

    applyTimerFromInputs(persist) {
      this.applyTimerDurations(this.elements.timerWorkInput.value, this.elements.timerBreakInput.value, persist);
    }

    applyTimerDurations(workValue, breakValue, persist) {
      const result = this.timer.setDurations(workValue, breakValue, { resetCurrent: true });

      this.elements.timerWorkInput.value = String(result.workMinutes);
      this.elements.timerBreakInput.value = String(result.breakMinutes);

      if (persist) {
        Storage.set(STORAGE_KEYS.timerWorkMinutes, result.workMinutes);
        Storage.set(STORAGE_KEYS.timerBreakMinutes, result.breakMinutes);
      }
    }

    addGoalFromInput() {
      const rawValue = this.elements.goalInput.value || "";
      const goalText = rawValue.trim();
      if (!goalText) {
        return;
      }

      this.addGoal(goalText);
      this.elements.goalInput.value = "";
      this.elements.goalInput.focus();
    }

    addGoal(goalText) {
      if (this.goals.length >= 20) {
        this.goals.shift();
      }

      this.goals.push({ text: goalText, done: false });
      this.persistGoals();
      this.renderGoals();
    }

    toggleGoalDone(index) {
      if (index < 0 || index >= this.goals.length) {
        return;
      }

      this.goals[index].done = !this.goals[index].done;
      this.persistGoals();
      this.renderGoals();
    }

    removeGoal(index) {
      if (index < 0 || index >= this.goals.length) {
        return;
      }

      this.goals.splice(index, 1);
      this.persistGoals();
      this.renderGoals();
    }

    persistGoals() {
      Storage.set(STORAGE_KEYS.goals, this.goals);
    }

    renderGoals() {
      const goalList = this.elements.goalList;
      goalList.textContent = "";

      if (!this.goals.length) {
        const empty = document.createElement("li");
        empty.className = "goal-empty";
        empty.textContent = "Henüz hedef yok.";
        goalList.appendChild(empty);
        return;
      }

      this.goals.forEach((goal, index) => {
        const item = document.createElement("li");
        item.className = "goal-item";
        if (goal.done) {
          item.classList.add("is-done");
        }

        const bullet = document.createElement("span");
        bullet.className = "goal-bullet";
        bullet.textContent = "•";

        const text = document.createElement("span");
        text.className = "goal-text";
        text.textContent = goal.text;

        const check = document.createElement("button");
        check.className = "goal-check";
        check.type = "button";
        check.dataset.action = "toggle";
        check.dataset.index = String(index);
        check.setAttribute(
          "aria-label",
          goal.done ? `Tamamlandı işaretini kaldır: ${goal.text}` : `Hedefi tamamlandı olarak işaretle: ${goal.text}`
        );
        check.textContent = "✓";
        check.classList.toggle("is-done", goal.done);

        const remove = document.createElement("button");
        remove.className = "goal-remove";
        remove.type = "button";
        remove.dataset.action = "remove";
        remove.dataset.index = String(index);
        remove.setAttribute("aria-label", `Hedefi sil: ${goal.text}`);
        remove.textContent = "x";

        item.appendChild(bullet);
        item.appendChild(text);
        item.appendChild(check);
        item.appendChild(remove);
        goalList.appendChild(item);
      });
    }

    async toggleSound(nextState, persist) {
      const enabled = await this.audio.setEnabled(Boolean(nextState));
      this.renderSound(enabled);

      if (persist) {
        Storage.set(STORAGE_KEYS.soundEnabled, enabled);
      }
    }

    renderSound(enabled) {
      this.elements.soundToggle.textContent = enabled ? "Açık" : "Kapalı";
      this.elements.soundToggle.classList.toggle("is-active", enabled);
      this.elements.soundToggle.setAttribute("aria-pressed", String(enabled));
    }

    updateClock() {
      const now = new Date();

      this.elements.clock.textContent = now.toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });

      this.elements.date.textContent = now.toLocaleDateString("tr-TR", {
        weekday: "long",
        day: "numeric",
        month: "long"
      });
    }

    renderTimer(remaining, phase, running) {
      const formattedTime = this.formatTime(remaining);
      const phaseLabel = phase === "work" ? "Çalışma" : "Ara";

      this.elements.timerDisplay.textContent = formattedTime;
      this.elements.timerPhase.textContent = phaseLabel;
      this.elements.centerTimerDisplay.textContent = formattedTime;
      this.elements.centerTimerPhase.textContent = phaseLabel;

      this.elements.timerStart.disabled = running;
      this.elements.timerStop.disabled = !running;
    }

    formatTime(seconds) {
      const mins = Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0");
      const secs = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");
      return `${mins}:${secs}`;
    }
  }

  const init = () => {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas) {
      return;
    }

    const engine = new CanvasEngine(canvas);
    const audio = new AudioEngine();
    const ui = new UIController({ engine, audio });

    ui.init();
  };

  window.addEventListener("DOMContentLoaded", init);
})();
