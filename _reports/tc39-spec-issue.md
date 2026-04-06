# TC39 / ecma262 Spec Issue Draft

**File at:** https://github.com/tc39/ecma262/issues
**Label suggestions:** needs consensus, normative change, memory model

---

## Title

`Atomics.wait` "not-equal" return path lacks happens-before ordering guarantee — two independent engines affected

## Body

### Summary

When `Atomics.wait(typedArray, index, value)` returns `"not-equal"` because the value at `index` has already changed, the memory model does not clearly establish a happens-before edge from the stores that preceded the value change. Two independent JavaScript engines (V8 and SpiderMonkey) both exhibit identical behavior: **~63-66% of cross-worker reads are stale** after a barrier that relies on `Atomics.wait` / `Atomics.notify` with 3+ workers.

The fact that two completely independent engine implementations produce the same failure at the same rate strongly suggests this is a **spec ambiguity**, not an engine implementation bug.

### The problem

A standard generation-counting barrier using `Atomics.wait` / `Atomics.notify`:

```javascript
function barrier(view, arrivalIdx, genIdx, workerCount) {
    const myGen = Atomics.load(view, genIdx);
    const arrived = Atomics.add(view, arrivalIdx, 1) + 1;
    if (arrived === workerCount) {
        // Last arriver: reset counter, bump generation, wake waiters
        Atomics.store(view, arrivalIdx, 0);
        Atomics.store(view, genIdx, myGen + 1);
        Atomics.notify(view, genIdx, workerCount - 1);
    } else {
        // Wait for generation to change
        Atomics.wait(view, genIdx, myGen);
    }
}
```

With 3 workers, there is a race: a non-last worker may call `Atomics.wait` *after* the last worker has already bumped the generation. In this case, `Atomics.wait` returns `"not-equal"` immediately. The worker proceeds past the barrier — but **does not see stores from other workers** that preceded the generation bump.

Replacing `Atomics.wait` with `while (Atomics.load(view, genIdx) === myGen) {}` fixes the issue completely, because every `Atomics.load` is seq_cst and the total order guarantees visibility.

### Evidence across engines and architectures

All three major JavaScript engines are affected. Testing via BrowserStack confirmed cross-platform scope:

**V8 (Chrome / Edge / Node.js):**

| Environment | Platform | Error Rate | Notes |
|-------------|----------|-----------|-------|
| Node.js 22.14 (V8 12.4) | x86-64, Windows 11 | ~66% | 50K iterations |
| Chrome 146 (V8 14.6) | x86-64, Windows 11 | 10.5% | Escalating 1K-100K |
| Edge 146 (V8 14.6) | x86-64, Windows 11 | 28.2% | BrowserStack |
| Chrome Canary 148 | x86-64, Windows 11 | 0.0007% (1/135K) | Rare but confirmed |
| Android Chrome (V8 latest) | ARM Cortex-A715/A510 | 22.3% (2 workers!) | ARM fails even with 2 workers |
| Chrome 146 | macOS Tahoe (Apple Silicon) | **0%** (10 runs) | Appears fixed |
| Edge 146 | macOS Tahoe (Apple Silicon) | **0%** (10 runs) | Appears fixed |

**SpiderMonkey (Firefox):**

| Environment | Platform | Error Rate | Notes |
|-------------|----------|-----------|-------|
| Firefox 148 | x86-64, Windows 11 | 63.2% | Fails at 1K iterations |
| Firefox 149 | macOS Tahoe (Apple Silicon) | 10.3% | BrowserStack |

**JavaScriptCore (Safari):**

| Environment | Platform | Error Rate | Notes |
|-------------|----------|-----------|-------|
| Safari 18 | macOS Sequoia | 10.8% | BrowserStack |
| Safari 17 | macOS Sonoma | 50.9% | BrowserStack |
| Safari 26 | macOS Tahoe | 26.1% | BrowserStack |
| Safari iOS 18 (iPhone 16) | ARM (Apple A18) | 21.3% | BrowserStack |
| Safari iOS 16 (iPhone 14) | ARM (Apple A15) | 21.1% | BrowserStack |

**V8 has progressively fixed the fence** — from 66% (V8 12.4) down to 0% on macOS Tahoe. On the same macOS Tahoe BrowserStack host where V8 passes, SpiderMonkey (10.3%) and JSC (26.1%) still fail. SpiderMonkey and JavaScriptCore show no improvement trend.

**The ARM result is critical.** On Android (MediaTek Dimensity 8300, ARM Cortex-A715/A510), V8 fails with just **2 workers** at 22.3% — a test that passes on every x86 system. x86's Total Store Order (TSO) provides implicit store ordering that partially masks the missing fence. ARM's relaxed memory model exposes the bug completely.

### Spec analysis

**Section 25.4.12 (Atomics.wait):**
The algorithm enters the WaiterList critical section, performs an atomic read to compare values, and if they differ, returns `"not-equal"` after exiting the critical section. The critical section entry/exit provides mutual exclusion with `Atomics.notify`, but the spec does not explicitly state that the "not-equal" path establishes a Synchronize relationship with the agent that performed the store observed by the comparison.

**Section 29 (Memory Model):**
The Synchronize relationship between `Atomics.notify` and agents it wakes is well-defined (29.10, 29.11). However, an agent whose `Atomics.wait` returns `"not-equal"` was never added to the WaiterList and was never woken by `Atomics.notify`. The synchronization edge flows through the wake path — but the "not-equal" path bypasses this entirely.

**The gap:** The "not-equal" return implies the agent *observed* a value written by another agent (the generation was bumped). Intuitively, this observation should carry a happens-before edge from all prior stores by the writing agent. But the spec's synchronization model is defined in terms of WaiterList operations and `Atomics.notify` wake events — neither of which occurs on the "not-equal" path.

### Comparison with WebAssembly

The WebAssembly threads spec for `memory.atomic.wait32` explicitly requires an ARD_SEQCST (atomic read with sequential consistency) as the first step. If implemented correctly, the seq_cst read should provide ordering regardless of the return value. Despite this, the bug manifests in Wasm contexts as well (discovered while implementing multi-worker Wasm kernel dispatch in SpawnDev.ILGPU).

### Proposed clarification

The spec should explicitly state that when `Atomics.wait` returns `"not-equal"`, the atomic comparison that detected the value mismatch establishes a Synchronize relationship equivalent to a seq_cst load. Specifically:

> When `Atomics.wait` returns `"not-equal"`, the comparison read Synchronizes-with the most recent `Atomics.store` or `Atomics.compareExchange` that wrote the observed value. All stores that happened-before that write are guaranteed to be visible to the agent after `Atomics.wait` returns.

This would align the ECMAScript spec with:
1. The WebAssembly threads spec (which already requires ARD_SEQCST)
2. Developer expectations (observing a value change implies seeing all prior stores)
3. The behavior of `Atomics.load` (which is unambiguously seq_cst)

### Workaround

Replace `Atomics.wait` with a spin loop on `Atomics.load`:
```javascript
while (Atomics.load(view, genIdx) === myGen) {}
```
This works because `Atomics.load` is unambiguously seq_cst.

### Reproducer

- **GitHub repo:** https://github.com/LostBeard/v8-atomics-wait-bug
- **Live demo:** https://lostbeard.github.io/v8-atomics-wait-bug/ (runs in any browser with SharedArrayBuffer support)
- **Chromium issue:** https://issues.chromium.org/issues/495679735

### Discovery context

This was discovered by the [SpawnDev.ILGPU](https://github.com/LostBeard/SpawnDev.ILGPU) team while implementing multi-worker WebAssembly kernel dispatch. The workaround (spin barriers using `i32.atomic.load`) shipped in v4.6.0 with 0 test failures across 249 Wasm backend tests.
