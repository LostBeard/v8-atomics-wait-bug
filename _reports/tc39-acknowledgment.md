# TC39 Acknowledgment

---

@syg You were right, and I owe you a thank you.

We added a 4th test to the demo - wait/notify with a proper loop around Atomics.wait - and it passes with 0 stale reads on every engine and platform we tested:

- Chrome 146 (V8): 0/144,000
- Firefox 149 (SpiderMonkey): 0/9,000
- Safari 26 (JSC): 0/18,000
- Android Chrome on Samsung Galaxy S26 (ARM): 0

The bug was in our barrier, not in the engines. A single Atomics.wait without a loop is vulnerable to spurious cross-barrier wakeups - notify from barrier N can wake a waiter that has already advanced to barrier N+1 on the same index. The standard while-loop pattern handles this correctly, just like any condition variable.

The demo and repo have been updated to reflect this. Test 2 now explicitly demonstrates the buggy pattern, and Tests 1, 3, and 4 show correct approaches. Your name is credited in the update notes.

I'm updating and closing the Chromium, Firefox, and WebKit bug reports with the same acknowledgment.

I apologize for the noise. We genuinely believed this was an engine issue, and the cross-engine consistency made it convincing. But the data led us to the wrong conclusion, and your analysis of the barrier interleaving was the key to finding the real cause. Thank you for taking the time to explain it.

The demo is live at https://lostbeard.github.io/v8-atomics-wait-bug/ with the corrected tests.
