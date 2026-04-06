# Firefox Bugzilla Report

**File at:** https://bugzilla.mozilla.org/enter_bug.cgi
**Product:** Core
**Component:** JavaScript Engine
**Version:** Firefox 148
**OS:** All
**Hardware:** All
**Severity:** S3 (normal)
**Priority:** -- (let triage set it)
**Keywords:** memory-safety, spec-conformance

---

## Title

`Atomics.wait` "not-equal" return path missing memory fence — 63% stale reads with 3+ workers

## Description

### Summary

When `Atomics.wait` returns `"not-equal"` (because the watched value has already changed before the call), SpiderMonkey does not appear to emit a full sequential-consistency memory fence. This causes workers that take the "not-equal" fast path to read stale values from `SharedArrayBuffer` — values written by other workers before the barrier are invisible.

The failure rate is ~63% of cross-worker reads, which matches the theoretical 2/3 expected when the fence is missing (3 workers, each reading 2 other workers' slots).

**This is not SpiderMonkey-specific.** V8 exhibits the same bug at similar rates. A Chromium issue is already filed: https://issues.chromium.org/issues/495679735. Two independent engines failing identically suggests this may be a spec-level ambiguity in the ECMAScript memory model.

### Steps to Reproduce

**Option 1 — Live demo (easiest):**
1. Open https://lostbeard.github.io/v8-atomics-wait-bug/ in Firefox
2. Click "Run All Tests"
3. Observe Test 2 fails with stale reads

**Option 2 — Local (Node.js reproducer adapted for SpiderMonkey):**
1. Clone https://github.com/LostBeard/v8-atomics-wait-bug
2. Open `index.html` in Firefox (serve via `python -m http.server` for SharedArrayBuffer support, or the service worker will inject COOP/COEP headers)
3. Run all three tests

### What the test does

Three workers synchronize using a standard **generation-counting barrier**:

```javascript
function barrier(view, arrivalIdx, genIdx, workerCount) {
    const myGen = Atomics.load(view, genIdx);
    const arrived = Atomics.add(view, arrivalIdx, 1) + 1;
    if (arrived === workerCount) {
        Atomics.store(view, arrivalIdx, 0);
        Atomics.store(view, genIdx, myGen + 1);
        Atomics.notify(view, genIdx, workerCount - 1);
    } else {
        Atomics.wait(view, genIdx, myGen);
    }
}
```

Each iteration: workers write a unique value to their slot, enter the barrier, then read all other workers' slots and verify the values match the current iteration.

**Three tests isolate the bug:**
| Test | Workers | Barrier | Expected | Actual (Firefox 148) |
|------|---------|---------|----------|---------------------|
| 1. Control | 2 | wait/notify | PASS | **PASS** — 0 stale reads |
| 2. Bug trigger | 3 | wait/notify | PASS | **FAIL** — 63.2% stale reads at 1K iterations |
| 3. Workaround | 3 | spin (`Atomics.load` loop) | PASS | **PASS** — 0 stale reads |

### Expected Behavior

After `Atomics.wait` returns (regardless of return value — `"ok"`, `"not-equal"`, or `"timed-out"`), all prior stores from all agents that happened-before the event that caused the return should be visible.

Specifically: when `Atomics.wait` returns `"not-equal"`, the value comparison performed an atomic read. That read observed a value written by another agent (the generation bump). All stores that happened-before that write should be visible to the waiting agent.

### Actual Behavior

When `Atomics.wait` returns `"not-equal"`, stores from other workers that preceded the generation bump are **not visible**. Workers read stale (zero or previous-iteration) values from other workers' slots. The error rate is ~63%, consistent with the missing fence affecting 2 out of 3 cross-worker read pairs.

### Why the spin workaround works

Replacing `Atomics.wait` with:
```javascript
while (Atomics.load(view, genIdx) === myGen) {}
```
fixes the issue completely. Every `Atomics.load` is seq_cst per the ECMAScript spec. When the load observes the new generation, the seq_cst total order guarantees all prior stores are visible.

### Test environment — SpiderMonkey results

**Firefox 148 / Windows 11** (AMD Ryzen 5 7500F, 6c/12t):

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger | 3 | wait/notify | 1,897 / 3,000 | **63.2%** | **FAIL** |
| 3. Workaround | 3 | spin (Atomics.load) | 0 / 9,000 | 0% | **PASS** |

**Firefox 149 / macOS Tahoe** (Apple Silicon, 10 cores, via BrowserStack):

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger | 3 | wait/notify | 4,004 / 39,000 | **10.3%** | **FAIL** |
| 3. Workaround | 3 | spin (Atomics.load) | 0 / 36,000 | 0% | **PASS** |

SpiderMonkey fails on both x86 (Windows) and ARM (macOS Apple Silicon). On the same macOS Tahoe BrowserStack host, V8 (Chrome/Edge 146) passes with 0 stale reads — confirming V8 has fixed the fence while SpiderMonkey has not.

### Spec references

- **ECMAScript Section 25.4.12** ([Atomics.wait](https://tc39.es/ecma262/#sec-atomics.wait)) — The "not-equal" path returns immediately after the value comparison without suspending. The spec enters/exits a WaiterList critical section, which should synchronize with `Atomics.notify`.
- **ECMAScript Section 29** ([Memory Model](https://tc39.es/ecma262/#sec-memory-model)) — Defines Synchronize relationships and happens-before. The synchronization edge from `Atomics.notify` to woken agents is clear, but the "not-equal" path (which never suspends) may lack an explicit synchronization edge.
- **WebAssembly Threads** ([memory.atomic.wait32](https://webassembly.github.io/threads/core/exec/instructions.html)) — Specifies ARD_SEQCST as the first step, which should provide ordering regardless of return value.

### All three major engines affected

| Engine | Platform | Error Rate |
|--------|----------|-----------|
| V8 12.4 (Node.js 22.14) | x86-64, Windows | ~66% |
| V8 14.6 (Chrome 146) | x86-64, Windows | 10.5% |
| V8 14.6 (Chrome 146) | macOS Tahoe | **0%** (fixed) |
| **SpiderMonkey (Firefox 148)** | **x86-64, Windows** | **63.2%** |
| **SpiderMonkey (Firefox 149)** | **macOS Tahoe** | **10.3%** |
| JSC (Safari 18) | macOS Sequoia | 10.8% |
| JSC (Safari 17) | macOS Sonoma | 50.9% |
| JSC (Safari 26) | macOS Tahoe | 26.1% |
| JSC (Safari iOS 18) | ARM (iPhone 16) | 21.3% |

V8 has progressively fixed this bug and now passes on macOS. SpiderMonkey and JSC remain affected on all platforms.

### Related bugs

- **Chromium:** https://issues.chromium.org/issues/495679735 (V8 — same bug, filed first)
- **WebKit:** *Filing concurrently*
- **Reproducer repo:** https://github.com/LostBeard/v8-atomics-wait-bug
- **Live demo:** https://lostbeard.github.io/v8-atomics-wait-bug/

Cross-browser testing powered by [BrowserStack](https://www.browserstack.com).
