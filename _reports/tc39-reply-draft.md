# TC39 Reply Draft

**In reply to:** "Step 19 of DoWait is a seq-cst read. I don't think I'm following."

---

You're right that step 19 of DoWait performs a `GetValueFromBuffer` with `seq-cst` ordering. I've traced the full spec path to understand the implications:

**DoWait "not-equal" path:**
- Step 18: `EnterCriticalSection(WL)` — if `WL.[[MostRecentLeaveEvent]]` is not empty, creates a Synchronize event that synchronizes-with the most recent `LeaveCriticalSection`
- Step 20: `GetValueFromBuffer(..., seq-cst)` — via `GetRawBytesFromSharedBlock`, creates a `ReadSharedMemory { [[Order]]: seq-cst }` event
- Step 21a: `LeaveCriticalSection(WL)` — creates a new Synchronize event, updates `MostRecentLeaveEvent`
- Step 21b: return `"not-equal"`

Per the synchronizes-with definition ([Section 29.8](https://tc39.es/ecma262/#sec-synchronizes-with)): a seq-cst write _W_ synchronizes-with a seq-cst read _R_ if _R_ reads-from _W_ **and they have equal memory ranges**. So the step 20 read of the generation counter should synchronize-with the seq-cst write that stored the new generation value.

Since happens-before is transitive ([Section 29.9](https://tc39.es/ecma262/#sec-happens-before)), the full chain for our barrier pattern should be:

```
Worker A: store data[0]  --agent-order-->  Atomics.add(arrival)
Worker C: Atomics.add(arrival) observes all arrivals  --agent-order-->  Atomics.store(gen, newGen)
Worker B: DoWait step 20 reads gen (seq-cst)  --synchronizes-with-->  Worker C's store(gen)
Worker B: DoWait returns  --agent-order-->  read data[0]
```

If this chain holds, then Worker B's read of `data[0]` should see Worker A's store — and the spec does appear to require it.

**But all three engines violate this in practice.** The empirical data across 14 browser/device configurations:

| Engine | Platform | Error Rate |
|--------|----------|-----------|
| V8 (Node.js 22.14) | x86-64 | ~66% stale reads |
| SpiderMonkey (Firefox 148) | x86-64 | 63.2% |
| JSC (Safari 17) | macOS Sonoma | 50.9% |
| JSC (Safari iOS 18) | ARM (Apple A18) | 21.3% |

Android ARM devices fail even the **2-worker** control test (which passes on all x86 systems):

| Device | SoC | 2-Worker Error Rate |
|--------|-----|-------------------|
| Galaxy S26 | Snapdragon 8 Elite Gen 2 | 48.4% |
| Pixel Pro 10 XL | Google Tensor G5 | 14.5% |

Replacing `Atomics.wait` with `while (Atomics.load(...) === gen) {}` produces 0 stale reads on all engines and platforms — the barrier algorithm is correct, the issue is specifically in the `Atomics.wait` "not-equal" code path.

So if you're reading the spec correctly — and I believe you are — then this is a conformance bug in all three engines rather than a spec gap. The step 20 seq-cst read should be sufficient. The engines just aren't emitting the required fence when the value comparison fails and they take the early return.

V8 appears to be progressively fixing it (error rates: 66% in V8 12.4 → 10.5% in V8 14.6 → 0% on macOS Tahoe), which suggests they've independently identified the missing fence. SpiderMonkey and JSC show no improvement trend.

Does that reading of the synchronization chain look correct to you? I want to make sure I'm not missing a gap in the happens-before transitivity before concluding this is purely an engine conformance issue.

Reproducer: https://lostbeard.github.io/v8-atomics-wait-bug/
Full data: https://github.com/LostBeard/v8-atomics-wait-bug
