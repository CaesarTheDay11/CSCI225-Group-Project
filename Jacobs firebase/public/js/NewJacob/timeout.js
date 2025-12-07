// Simple match timeout utility
// Exports createMatchTimer(onTimeout, ms)
// Returns an object { start(), clear(), reset(), isActive }
export function createMatchTimer(onTimeout, ms = 5 * 60 * 1000) {
  let timer = null;
  let active = false;
  return {
    start() {
      try { this.clear(); active = true; timer = setTimeout(() => { active = false; try { onTimeout(); } catch (e) { console.error('matchTimer onTimeout error', e); } }, ms); } catch (e) { console.error('start timer error', e); }
    },
    clear() {
      try { if (timer) { clearTimeout(timer); timer = null; } active = false; } catch (e) { /* ignore */ }
    },
    reset() {
      try { if (!active) { this.start(); return; } this.clear(); this.start(); } catch (e) { console.error('reset timer error', e); }
    },
    isActive() { return !!active; }
  };
}
