# V8 `Atomics.wait` Visibility Bug

> **`Atomics.wait` returning `"not-equal"` does not provide happens-before ordering for third-party stores with 3+ workers.**
>
> **Chromium Issue:** https://issues.chromium.org/issues/495679735

This repository contains a minimal, runnable demonstration of a memory ordering bug in V8 (Chrome/Node.js) where the `Atomics.wait` / `memory.atomic.wait32` "not-equal" fast path fails to establish happens-before relationships, causing stale reads of shared memory.

## Live Demo

**https://lostbeard.github.io/v8-atomics-wait-bug/**

Run the tests directly in your browser — no install required. The demo auto-escalates iterations until the bug is detected or 100K iterations pass clean.

## The Bug

When 3 or more Web Workers synchronize using a **generation-counting barrier** with `Atomics.wait` / `Atomics.notify`:

1. Workers write data to shared memory
2. Workers enter a barrier (atomic arrival counter + generation bump + wait/notify)
3. After the barrier, workers read each other's data

**Expected:** All workers see all other workers' writes after the barrier.

**Actual (V8):** Workers whose `Atomics.wait` returns `"not-equal"` (because the generation was already bumped by the last arriver) do **not** see prior stores from other workers. **~66% of cross-worker reads are stale.**

The 66% figure is exact: with 3 workers, each reads 2 other workers' slots. 2/3 = 66.7%.

### Why It Happens

The happens-before edge flows: **Writer's stores -> Last Arriver (arrival counter) -> `Atomics.notify` -> Woken Waiters**. But when a waiter's `Atomics.wait` returns `"not-equal"` (the generation already changed before `wait` was called), V8 appears to skip the full seq_cst memory fence. The return value is correct (the generation did change), but the ordering guarantee is missing.

### Why The Spin Loop Works

Replacing `Atomics.wait` with `while (Atomics.load(view, genIdx) === myGen) {}` fixes the issue completely. Every `Atomics.load` is seq_cst — when the load finally observes the new generation, the total order property of seq_cst guarantees that **all** prior stores from **all** threads are visible. No ambiguity, no fast paths.

## Quick Start

### Browser (Live Demo)

Open `index.html` in Chrome. The page uses a service worker to enable cross-origin isolation (`SharedArrayBuffer` support) automatically.

If the service worker doesn't activate (e.g., `file://` protocol), serve locally:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve -p 8080

# Then open http://localhost:8080
```

### Node.js

```bash
# Bug reproducer (3 workers + wait/notify) — expect FAIL
node three_worker_barrier.mjs

# Workaround (3 workers + spin barrier) — expect PASS
node spin_barrier_3w.mjs
```

## Test Results

Three tests isolate the bug precisely:

### Node.js 22.14 (V8 12.4) — 50,000 iterations

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control (2 workers) | 2 | wait/notify | 0 | 0% | **PASS** |
| 2. Bug trigger (3 workers) | 3 | wait/notify | ~98,000 / 150,000 | **~66%** | **FAIL** |
| 3. Workaround (spin) | 3 | spin (Atomics.load) | 0 | 0% | **PASS** |

### Chrome 146 (V8 ~14.6) — escalating 1K to 100K

| Test | Workers | Barrier | Stale Reads | Error Rate | Result |
|------|---------|---------|-------------|------------|--------|
| 1. Control (2 workers) | 2 | wait/notify | 0 / 200,000 | 0% | **PASS** |
| 2. Bug trigger (3 workers) | 3 | wait/notify | 39,368 / 375,000 | **10.5%** | **FAIL** |
| 3. Workaround (spin) | 3 | spin (Atomics.load) | 0 / 288,000 | 0% | **PASS** |

- **Test 1** proves the barrier algorithm is correct with 2 workers.
- **Test 2** proves it breaks with 3 workers and `Atomics.wait`. The error rate varies between V8 versions (66% on V8 12.4 vs 10.5% on V8 ~14.6), but any stale read is a correctness violation.
- **Test 3** proves the spin workaround fixes it on all tested versions.

## Spec References

### ECMAScript (Atomics.wait)

[Section 25.4.12](https://tc39.es/ecma262/#sec-atomics.wait) — The agent enters the WaiterList critical section, compares the value, and returns `"not-equal"` if they differ. The critical section entry/exit should synchronize with `Atomics.notify` per the memory model.

### ECMAScript Memory Model

[Section 29](https://tc39.es/ecma262/#sec-memory-model) — Defines Synchronize events and happens-before. `Atomics.notify` synchronizes-with agents it wakes. The `"not-equal"` path should also establish ordering through the shared critical section, but V8 appears to optimize this away.

### WebAssembly Threads

[`memory.atomic.wait32`](https://webassembly.github.io/threads/core/exec/instructions.html) — Performs an ARD<sub>SEQCST</sub> (atomic read with sequential consistency) as its first step. The seq_cst ordering should apply regardless of whether the result is "ok", "not-equal", or "timed-out".

## Affected Environments

| Environment | V8 Version | Error Rate | Status |
|-------------|-----------|-----------|--------|
| Node.js 22.14.0 | V8 12.4.254.21 | **~66%** stale reads | **Affected** — highly reproducible |
| Chrome 146 | V8 ~14.6.x | **10.5%** stale reads | **Affected** — confirmed with escalating test |
| Firefox (SpiderMonkey) | N/A | — | Not tested |
| Safari (JavaScriptCore) | N/A | — | Not tested |

**Important:** Node.js and Chrome ship **different V8 versions**. Both exhibit the bug, but at different rates (66% vs 10.5%), suggesting the issue has been partially mitigated in newer V8 but not fully fixed. The intermittent nature in Chrome makes this bug particularly dangerous — it surfaces under sustained high-volume barrier synchronization, exactly the scenario used by real applications (GPU kernel dispatch, parallel algorithms, etc.).

**System tested on:** Windows 11, AMD Ryzen 5 7500F (6 cores / 12 threads)

### Chrome Results Detail (Escalating Test)

The browser demo auto-escalates Test 2 from 1,000 to 100,000 iterations (doubling each round) until a stale read is detected. Results on Chrome 146:

- Test 1 (2 workers, wait/notify, 50K): **PASS** — 0 / 200,000 stale reads
- Test 2 (3 workers, wait/notify, escalating): **FAIL** — 39,368 / 375,000 stale reads (10.5%)
- Test 3 (3 workers, spin, matched iterations): **PASS** — 0 / 288,000 stale reads

If Test 2 reaches 100,000 iterations with 0 stale reads, the bug is considered not applicable to that environment.

## Impact

This bug affects **any multi-worker `SharedArrayBuffer` code** that uses `Atomics.wait`/`Atomics.notify` barriers with 3+ workers — including WebAssembly `memory.atomic.wait32`/`memory.atomic.notify`.

## Discovery

This bug was discovered by the SpawnDev.ILGPU development team while implementing multi-worker WebAssembly kernel dispatch in [SpawnDev.ILGPU](https://github.com/LostBeard/SpawnDev.ILGPU) v4.6.0. The library compiles .NET GPU kernels to WebAssembly and dispatches them across multiple Web Workers with barrier synchronization.

**The team:**
- **TJ (Todd Tanner / [@LostBeard](https://github.com/LostBeard))** — Project lead, SpawnDev.ILGPU author
- **Riker (Claude CLI #1)** — Isolated the bug to `wait32` "not-equal" return path, built the definitive 3-test reproducer proving 2 workers pass / 3 workers fail / spin works
- **Data (Claude CLI #2)** — Confirmed the 2/3 stale-read fraction analysis, correlated with seq_cst spec requirements, identified the "not-equal" fast path as the likely V8 implementation gap
- **Tuvok (Cursor Composer)** — Traced the full fence layout and barrier protocol, confirming generation advancement logic correctness

The workaround — pure spin barriers using `i32.atomic.load` instead of `memory.atomic.wait32` — is shipped in SpawnDev.ILGPU v4.6.0 and resolves 249 Wasm backend tests with 0 failures.

## Repository Structure

```
V8Bug/
├── index.html               # Interactive browser demo (run all 3 tests)
├── worker.js                 # Shared worker (both barrier modes)
├── coi-serviceworker.js      # Cross-origin isolation for GitHub Pages
├── style.css                 # Dark theme styling
├── three_worker_barrier.mjs  # Node.js reproducer (FAIL expected)
├── spin_barrier_3w.mjs       # Node.js control test (PASS expected)
├── LICENSE                   # MIT
└── README.md                 # This file
```

## License

MIT
