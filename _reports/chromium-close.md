# Chromium Bug Close Comment

---

Closing this - the bug was in our barrier implementation, not in V8.

Our barrier used a single Atomics.wait without a loop, making it vulnerable to spurious cross-barrier wakeups. When Atomics.notify fires for barrier N, it can wake a waiter that has already advanced to barrier N+1 on the same index. Without a loop to re-check the generation value, the worker proceeds as if the barrier completed when it hasn't.

The fix is the standard while-loop pattern around Atomics.wait:

```javascript
while (Atomics.load(v, GEN) === gen) {
    Atomics.wait(v, GEN, gen);
}
```

We verified this fix produces 0 stale reads across Chrome, Firefox, Safari, and Android ARM devices.

Credit to Shu-yu Guo for identifying the spurious wakeup issue on the TC39 repo (https://github.com/tc39/ecma262/issues/3800). Apologies for the false report and thank you to the Chrome team for the time spent investigating.
