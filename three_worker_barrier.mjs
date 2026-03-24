// three_worker_barrier.mjs — V8 Atomics.wait visibility bug reproducer
//
// Demonstrates that Atomics.wait returning "not-equal" does NOT provide
// happens-before ordering for third-party stores when 3+ workers synchronize
// via a generation-counting barrier with wait/notify.
//
// Run: node three_worker_barrier.mjs
//
// Expected: FAIL — ~66% of cross-worker reads are stale.
// The 66% (2/3) corresponds to reading 2 other workers' slots per iteration.

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const WORKER_COUNT = 3;
const ITERATIONS = 50_000;

if (isMainThread) {
    const sab = new SharedArrayBuffer(4096);

    console.log('V8 Atomics.wait Visibility Bug — Reproducer');
    console.log('============================================');
    console.log(`Workers: ${WORKER_COUNT}  |  Iterations: ${ITERATIONS}  |  Barrier: wait/notify`);
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
                    console.log('FAIL — Atomics.wait/notify barrier did NOT provide');
                    console.log('       happens-before ordering for third-party stores.');
                } else {
                    console.log('PASS — No stale reads detected.');
                }
                workers.forEach(w => w.terminate());
            }
        });
    }
} else {
    const { sab, wid, n, iters } = workerData;
    const v = new Int32Array(sab);
    // v[0..2] = data slots, v[8] = arrival, v[9] = generation
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
            // Single wait — NO loop. Critical to reproducing the bug.
            // If wait returns "not-equal" (gen already changed), V8 does
            // NOT enforce happens-before, so subsequent reads see stale data.
            Atomics.wait(v, GEN, gen);
        }
    }

    for (let i = 0; i < iters; i++) {
        // Write unique value to our data slot
        Atomics.store(v, wid, i * 10 + wid + 1);

        // Barrier — all workers should see each other's writes after this
        barrier();

        // Read all workers' values
        for (let j = 0; j < n; j++) {
            const val = Atomics.load(v, j);
            const expected = i * 10 + j + 1;
            if (val !== expected) errors++;
            checks++;
        }

        // Barrier before next iteration
        barrier();
    }

    parentPort.postMessage({ wid, errors, checks });
}
