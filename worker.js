// worker.js — Barrier test worker for V8 Atomics.wait bug demo
//
// Supports two barrier modes:
//   'wait-notify' — Uses Atomics.wait/notify (triggers the bug with 3+ workers)
//   'spin'        — Uses Atomics.load spin loop (correct workaround)
//
// Memory layout (Int32Array indices) — matches the Node.js reproducers:
//   [0..N-1] Per-worker data slots (one i32 per worker)
//   [8]      Arrival counter
//   [9]      Generation counter
//
// A single barrier object is used for both sync points (write→read and
// read→write). The generation increments by 1 per barrier call.

self.onmessage = function (e) {
    const { mode, sab, workerId, workerCount, iterations } = e.data;
    const v = new Int32Array(sab);
    const ARR = 8, GEN = 9;

    // --- Barrier implementations ---

    function barrierWaitNotify() {
        const gen = Atomics.load(v, GEN);
        const arr = Atomics.add(v, ARR, 1) + 1;
        if (arr === workerCount) {
            Atomics.store(v, ARR, 0);
            Atomics.store(v, GEN, gen + 1);
            Atomics.notify(v, GEN, workerCount - 1);
        } else {
            // Single wait — NO loop. This is critical to reproducing the bug.
            // If wait returns "not-equal" (gen already changed), the worker
            // proceeds immediately. V8 does NOT enforce happens-before in
            // this case, so subsequent reads see stale data.
            //
            // Wrapping this in a while(Atomics.load(...)) loop would MASK
            // the bug because Atomics.load is seq_cst — the same fix as
            // the spin barrier.
            Atomics.wait(v, GEN, gen);
        }
    }

    function barrierWaitNotifyLoop() {
        const gen = Atomics.load(v, GEN);
        const arr = Atomics.add(v, ARR, 1) + 1;
        if (arr === workerCount) {
            Atomics.store(v, ARR, 0);
            Atomics.store(v, GEN, gen + 1);
            Atomics.notify(v, GEN, workerCount - 1);
        } else {
            // Wait in a loop - standard spurious wakeup defense.
            // Re-checks GEN after each wake to handle cross-barrier
            // notify wakeups (a notify from barrier N can wake a
            // waiter that has already advanced to barrier N+1).
            while (Atomics.load(v, GEN) === gen) {
                Atomics.wait(v, GEN, gen);
            }
        }
    }

    function barrierSpin() {
        const gen = Atomics.load(v, GEN);
        const arr = Atomics.add(v, ARR, 1) + 1;
        if (arr === workerCount) {
            Atomics.store(v, ARR, 0);
            Atomics.store(v, GEN, gen + 1);
        } else {
            while (Atomics.load(v, GEN) === gen) {
                // Pure spin - seq_cst atomic load on every iteration.
                // When we observe the new generation, ALL prior stores
                // from ALL threads are guaranteed visible.
            }
        }
    }

    const barrier = mode === 'spin' ? barrierSpin : mode === 'wait-notify-loop' ? barrierWaitNotifyLoop : mode === 'wait-notify-noloop' ? barrierWaitNotify : barrierWaitNotifyLoop;

    // --- Test loop ---

    let errors = 0;
    let checks = 0;

    for (let i = 0; i < iterations; i++) {
        // Write unique value to our data slot
        Atomics.store(v, workerId, i * 10 + workerId + 1);

        // Barrier — all workers should see each other's writes after this
        barrier();

        // Read all workers' values (including own — to match Node.js reproducer)
        for (let j = 0; j < workerCount; j++) {
            const val = Atomics.load(v, j);
            const expected = i * 10 + j + 1;
            if (val !== expected) errors++;
            checks++;
        }

        // Barrier before next iteration
        barrier();

        // Progress every 500 iterations
        if (i % 500 === 0) {
            self.postMessage({ type: 'progress', workerId, iteration: i, errors, checks });
        }
    }

    self.postMessage({ type: 'done', workerId, errors, checks });
};
