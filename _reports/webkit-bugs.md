# WebKit Bugs Report

**File at:** https://bugs.webkit.org/enter_bug.cgi
**Product:** WebKit
**Component:** JavaScriptCore
**Version:** Safari 18
**OS:** All (macOS + iOS)
**Hardware:** All
**Severity:** Normal
**Keywords:** SharedArrayBuffer, Atomics

---

## Title

`Atomics.wait` "not-equal" return path missing memory fence — stale reads with 3+ workers

## Description

### Summary

When `Atomics.wait` returns `"not-equal"` (because the watched value has already changed before the call), JavaScriptCore does not emit a full sequential-consistency memory fence. Workers that take the "not-equal" fast path read stale values from `SharedArrayBuffer` — values written by other workers before the barrier are invisible.

**This is not JSC-specific.** All three major JavaScript engines are affected: V8 (Chromium), SpiderMonkey (Firefox), and JavaScriptCore (Safari). Three independent engines failing identically confirms this is a **spec-level ambiguity** in the ECMAScript memory model. V8 has progressively fixed the fence in recent versions; SpiderMonkey and JavaScriptCore have not.

### Steps to Reproduce

1. Open https://lostbeard.github.io/v8-atomics-wait-bug/ in Safari
2. Click "Run All Tests"
3. Observe Test 2 fails with stale reads

Source: https://github.com/LostBeard/v8-atomics-wait-bug

### Test Results — JavaScriptCore

All tested via BrowserStack:

**Safari 18 / macOS Sequoia:**

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger | 3 | wait/notify | 1,625 / 15,000 | **10.8%** | **FAIL** |
| 3. Workaround | 3 | spin (Atomics.load) | 0 / 18,000 | 0% | **PASS** |

**Safari 17 / macOS Sonoma:**

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger | 3 | wait/notify | 1,526 / 3,000 | **50.9%** | **FAIL** |
| 3. Workaround | 3 | spin (Atomics.load) | 0 / 9,000 | 0% | **PASS** |

**Safari 26 / macOS Tahoe:**

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger | 3 | wait/notify | 784 / 3,000 | **26.1%** | **FAIL** |
| 3. Workaround | 3 | spin (Atomics.load) | 0 / 9,000 | 0% | **PASS** |

**Safari iOS 18 / iPhone 16 (ARM):**

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger | 3 | wait/notify | 638 / 3,000 | **21.3%** | **FAIL** |
| 3. Workaround | 3 | spin (Atomics.load) | 0 / 9,000 | 0% | **PASS** |

**Safari iOS 16 / iPhone 14 (ARM):**

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger | 3 | wait/notify | 634 / 3,000 | **21.1%** | **FAIL** |
| 3. Workaround | 3 | spin (Atomics.load) | 0 / 9,000 | 0% | **PASS** |

### Key observations

- JSC fails consistently across **all tested platforms** — macOS Sequoia, Sonoma, Tahoe, iOS 18, iOS 16
- Error rates range from 10.8% to 50.9% with no clear improvement trend across JSC versions
- On the **same macOS Tahoe BrowserStack host**, V8 (Chrome/Edge 146) passes with 0 stale reads across 10 runs, while JSC (Safari 26) fails at 26.1% — proving this is engine-specific, not hardware-related
- iOS ARM results (21%) are consistent with macOS results — the bug manifests on both x86 and ARM for JSC

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

Each iteration: workers write a unique value to their slot, enter the barrier, then read all other workers' slots and verify values match the current iteration.

### Expected Behavior

After `Atomics.wait` returns — regardless of return value (`"ok"`, `"not-equal"`, `"timed-out"`) — all prior stores from all agents that happened-before the event that caused the return should be visible.

### Actual Behavior

When `Atomics.wait` returns `"not-equal"`, stores from other workers that preceded the generation bump are **not visible**. Workers read stale values. The error rate (~10-50%) is consistent with the missing fence affecting cross-worker reads when the "not-equal" fast path is taken.

### Why the spin workaround works

```javascript
while (Atomics.load(view, genIdx) === myGen) {}
```
Every `Atomics.load` is seq_cst. When the load observes the new generation, the total order guarantees all prior stores are visible.

### Cross-engine results

| Engine | Platform | Error Rate |
|--------|----------|-----------|
| V8 12.4 (Node.js 22.14) | x86-64, Windows | ~66% |
| V8 14.6 (Chrome 146) | x86-64, Windows | 10.5% |
| V8 14.6 (Chrome 146) | macOS Tahoe | **0%** (fixed) |
| SpiderMonkey (Firefox 148) | x86-64, Windows | 63.2% |
| SpiderMonkey (Firefox 149) | macOS Tahoe | 10.3% |
| **JSC (Safari 18)** | **macOS Sequoia** | **10.8%** |
| **JSC (Safari 17)** | **macOS Sonoma** | **50.9%** |
| **JSC (Safari 26)** | **macOS Tahoe** | **26.1%** |
| **JSC (Safari iOS 18)** | **ARM (iPhone 16)** | **21.3%** |
| **JSC (Safari iOS 16)** | **ARM (iPhone 14)** | **21.1%** |

### Spec references

- **ECMAScript Section 25.4.12** ([Atomics.wait](https://tc39.es/ecma262/#sec-atomics.wait)) — The "not-equal" path returns without suspending. The spec enters/exits a WaiterList critical section, which should synchronize, but the memory model's synchronization edge may not cover this path.
- **ECMAScript Section 29** ([Memory Model](https://tc39.es/ecma262/#sec-memory-model)) — Synchronization is defined via `Atomics.notify` waking agents. The "not-equal" path — which never suspends — may lack an explicit synchronization edge.
- **WebAssembly Threads** ([memory.atomic.wait32](https://webassembly.github.io/threads/core/exec/instructions.html)) — Specifies ARD_SEQCST as the first step, which should provide ordering regardless of return value.

### Related bugs

- **Chromium:** https://issues.chromium.org/issues/495679735
- **Firefox (Bugzilla):** *Filing concurrently*
- **Reproducer:** https://github.com/LostBeard/v8-atomics-wait-bug
- **Live demo:** https://lostbeard.github.io/v8-atomics-wait-bug/

### Discovery

Discovered by the [SpawnDev.ILGPU](https://github.com/LostBeard/SpawnDev.ILGPU) team while implementing multi-worker WebAssembly kernel dispatch. The workaround (spin barriers using `Atomics.load`) shipped in v4.6.0 with 0 failures.

Cross-browser testing powered by [BrowserStack](https://www.browserstack.com).
