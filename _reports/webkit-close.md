# WebKit Bug Close Comment

---

Shu-yu Guo already closed this as INVALID, and he was right.

The bug was in our barrier implementation - a single Atomics.wait without a loop, vulnerable to spurious cross-barrier wakeups. The corrected barrier (with a while loop) produces 0 stale reads on Safari 26/macOS Tahoe and all other tested platforms.

Apologies for the false report. Full details at https://github.com/tc39/ecma262/issues/3800.
