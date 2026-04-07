# `Atomics.wait` Barrier Bug - A Lesson in Spurious Wakeups

> **Update (April 6, 2026): This was a bug in our barrier implementation, not in any browser engine.**
>
> Our original barrier used a single `Atomics.wait` without a loop, making it vulnerable to spurious cross-barrier wakeups. [Shu-yu Guo](https://github.com/nicolo-ribaudo) (TC39 / V8) identified the issue on the [TC39 repo](https://github.com/tc39/ecma262/issues/3800). All engine bug reports have been closed with apologies.

This repository demonstrates a common `Atomics.wait` barrier mistake and the correct fix. The original issue was filed as a browser engine bug, but turned out to be a barrier implementation error. We're keeping the repo as an educational resource.

## The Bug (In Our Code)

When using `Atomics.wait` / `Atomics.notify` in a generation-counting barrier, `Atomics.notify` wakes waiters **by index, not by value**. A notify intended for barrier N can wake a worker that has already advanced to barrier N+1 on the same index. Without a loop to re-check the condition, the worker exits the barrier prematurely and reads stale data.

### Buggy Barrier (Don't Do This)

```javascript
function barrier(view, arrivalIdx, genIdx, workerCount) {
    const myGen = Atomics.load(view, genIdx);
    const arrived = Atomics.add(view, arrivalIdx, 1) + 1;

    if (arrived === workerCount) {
        Atomics.store(view, arrivalIdx, 0);
        Atomics.add(view, genIdx, 1);
        Atomics.notify(view, genIdx);
    } else {
        // BUG: Single wait without a loop.
        // A notify from a different barrier call can wake this worker
        // spuriously, causing it to proceed before the barrier completes.
        Atomics.wait(view, genIdx, myGen);
    }
}
```

### Correct Barrier (Do This)

```javascript
function barrier(view, arrivalIdx, genIdx, workerCount) {
    const myGen = Atomics.load(view, genIdx);
    const arrived = Atomics.add(view, arrivalIdx, 1) + 1;

    if (arrived === workerCount) {
        Atomics.store(view, arrivalIdx, 0);
        Atomics.add(view, genIdx, 1);
        Atomics.notify(view, genIdx);
    } else {
        // Correct: loop handles spurious wakeups.
        // Re-check the generation after each wake.
        while (Atomics.load(view, genIdx) === myGen) {
            Atomics.wait(view, genIdx, myGen);
        }
    }
}
```

This is the same pattern used with condition variables in every threading library - always loop and re-check the condition after waking.

## Live Demo

**https://lostbeard.github.io/v8-atomics-wait-bug/**

Run the tests directly in your browser - no install required.

> **Note:** Results are non-deterministic due to the race condition nature of the bug. A test may pass on one run and fail on the next.

The demo runs 4 tests:

| Test | Workers | Barrier | Expected | What It Shows |
|------|---------|---------|----------|---------------|
| 1 | 2 | wait/notify (with loop) | **PASS** | Correct barrier works |
| 2 | 3 | wait/notify (NO loop) | **FAIL** | Buggy barrier - spurious wakeups cause stale reads |
| 3 | 3 | spin (Atomics.load) | **PASS** | Spin loop naturally re-checks the condition |
| 4 | 3 | wait/notify (with loop) | **PASS** | Correct barrier - loop handles spurious wakeups |

## Quick Start

### Browser (Live Demo)

Open `index.html` in any browser. The page uses a service worker to enable cross-origin isolation (`SharedArrayBuffer` support) automatically.

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
# Buggy barrier (3 workers + wait/notify, no loop) - expect FAIL
node three_worker_barrier.mjs

# Correct barrier (3 workers + wait/notify, with loop) - expect PASS
node three_worker_barrier_loop.mjs

# Spin barrier (3 workers + Atomics.load) - expect PASS
node spin_barrier_3w.mjs
```

## Why This Happens

`Atomics.notify(view, index, count)` wakes up to `count` waiters sleeping on `index`. It does not check what value each waiter expected. When multiple barriers share the same index (as in a double-barrier-per-iteration pattern), a notify from one barrier can wake a worker that has already advanced to the next barrier.

When `Atomics.wait` returns `"ok"` from a spurious wakeup, the worker has no way to know the wake wasn't meant for it - unless it re-checks the condition in a loop.

This is identical to the POSIX futex and pthread_cond_wait pattern: wakeups can be spurious, so you must always loop.

## The Original Mistake

We originally believed this was a memory ordering bug in the `Atomics.wait` "not-equal" return path - a missing seq_cst fence in all three major JavaScript engines (V8, SpiderMonkey, JavaScriptCore). We filed bug reports with [Chromium](https://issues.chromium.org/issues/495679735), [Firefox](https://bugzilla.mozilla.org/show_bug.cgi?id=2029633), [WebKit](https://bugs.webkit.org/show_bug.cgi?id=311568), and [TC39](https://github.com/tc39/ecma262/issues/3800).

Shu-yu Guo pointed out that the spec correctly requires a seq_cst read on the "not-equal" path (step 19 of DoWait), and that the real issue was our barrier's missing loop. We verified this by adding a 4th test (wait/notify with loop) which passes with 0 stale reads on every engine and platform - including Android ARM devices that were previously failing at 48%.

All bug reports have been closed with apologies and credit to Shu-yu Guo for the analysis.

## Repository Structure

```
V8Bug/
├── index.html                    # Interactive browser demo (4 tests)
├── worker.js                     # Shared worker (all barrier modes)
├── coi-serviceworker.js          # Cross-origin isolation for GitHub Pages
├── style.css                     # Dark theme styling
├── three_worker_barrier.mjs      # Node.js buggy barrier (FAIL expected)
├── three_worker_barrier_loop.mjs # Node.js correct barrier (PASS expected)
├── spin_barrier_3w.mjs           # Node.js spin barrier (PASS expected)
├── LICENSE                       # MIT
└── README.md                     # This file
```

## Discovery

This was discovered by the [SpawnDev.ILGPU](https://github.com/LostBeard/SpawnDev.ILGPU) team while implementing multi-worker WebAssembly kernel dispatch. We spent weeks convinced it was an engine-level issue before Shu-yu Guo identified the barrier bug.

**The team:**
- **TJ (Todd Tanner / [@LostBeard](https://github.com/LostBeard))** - Project lead, SpawnDev.ILGPU author
- **Riker (Claude CLI)** - Built the reproducer and test suite
- **Data (Claude CLI)** - Spec analysis and cross-engine testing
- **Tuvok (Claude CLI)** - Barrier protocol tracing and verification

**Credit:** [Shu-yu Guo](https://github.com/nicolo-ribaudo) (TC39 / V8) for identifying the real cause.

## Acknowledgments

Cross-browser testing for this project is powered by BrowserStack.

[![BrowserStack](https://www.browserstack.com/images/layout/browserstack-logo-600x315.png)](https://www.browserstack.com)

[BrowserStack](https://www.browserstack.com) provides free access to their cross-browser testing platform for open-source projects. Their support for the open-source community is invaluable - thank you.

## License

MIT
