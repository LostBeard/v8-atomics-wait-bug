// three_worker_barrier_loop.mjs - Tests if adding a loop around Atomics.wait fixes the barrier
//
// If syg is right (the bug is spurious cross-barrier wakeups, not a missing fence),
// this should PASS with 0 stale reads.
//
// Run: node three_worker_barrier_loop.mjs

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const WORKER_COUNT = 3;
const ITERATIONS = 50_000;

if (isMainThread) {
    const sab = new SharedArrayBuffer(4096);

    console.log('Atomics.wait Barrier with Loop - Verification Test');
    console.log('==================================================');
    console.log(`Workers: ${WORKER_COUNT}  |  Iterations: ${ITERATIONS}  |  Barrier: wait/notify WITH loop`);
    console.log('');

    let done = 0;
    let totalErrors = 0;
    let totalChecks = 0;
    const workers = [];

    for (let w = 0; w < WORKER_COUNT; w++) {
        const worker = new Worker(new URL(import.meta.url), {
            workerData: { sab, wid: w, n: WORKER_COUNT, iters: ITERATIONS }
        });
        workers.push(worker);

        worker.on('message', msg => {
            console.log(`  W${msg.wid}: ${msg.errors}/${msg.checks} errors (${(msg.errors / msg.checks * 100).toFixed(1)}%)`);
            totalErrors += msg.errors;
            totalChecks += msg.checks;
            done++;
            if (done === WORKER_COUNT) {
                console.log('');
                console.log(`  Total: ${totalErrors}/${totalChecks} stale reads (${(totalErrors / totalChecks * 100).toFixed(1)}%)`);
                console.log('');
                if (totalErrors > 0) {
                    console.log('FAIL - Loop did NOT fix the barrier.');
                    console.log('       This would suggest a real fence issue, not just spurious wakeups.');
                } else {
                    console.log('PASS - Loop fixed the barrier. The bug was spurious cross-barrier wakeups.');
                    console.log('       syg was right - this is a barrier bug, not an engine bug.');
                }
                workers.forEach(w => w.terminate());
            }
        });
    }
} else {
    const { sab, wid, n, iters } = workerData;
    const v = new Int32Array(sab);
    const ARR = 8, GEN = 9;
    let errors = 0, checks = 0;

    function barrier() {
        const gen = Atomics.load(v, GEN);
        const arr = Atomics.add(v, ARR, 1) + 1;
        if (arr === n) {
            Atomics.store(v, ARR, 0);
            Atomics.store(v, GEN, gen + 1);
            Atomics.notify(v, GEN, n - 1);
        } else {
            // Wait in a loop - handles spurious wakeups from cross-barrier notify
            while (Atomics.load(v, GEN) === gen) {
                Atomics.wait(v, GEN, gen);
            }
        }
    }

    for (let i = 0; i < iters; i++) {
        Atomics.store(v, wid, i * 10 + wid + 1);
        barrier();
        for (let j = 0; j < n; j++) {
            const val = Atomics.load(v, j);
            const expected = i * 10 + j + 1;
            if (val !== expected) errors++;
            checks++;
        }
        barrier();
    }

    parentPort.postMessage({ wid, errors, checks });
}
