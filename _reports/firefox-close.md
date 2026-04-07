# Firefox Bugzilla Close Comment

---

Closing this - the bug was in our barrier implementation, not in SpiderMonkey.

Our barrier used a single Atomics.wait without a loop, making it vulnerable to spurious cross-barrier wakeups. Atomics.notify wakes waiters by index, not by value - so a notify from barrier N can wake a waiter at barrier N+1. Without a loop to re-check, the worker exits the barrier prematurely.

The fix is wrapping Atomics.wait in a while loop that re-checks the condition:

```javascript
while (Atomics.load(v, GEN) === gen) {
    Atomics.wait(v, GEN, gen);
}
```

Verified: 0 stale reads across Chrome, Firefox, Safari, and Android ARM with the corrected barrier.

Credit to Shu-yu Guo for identifying the issue (https://github.com/tc39/ecma262/issues/3800). Apologies for the false report.
