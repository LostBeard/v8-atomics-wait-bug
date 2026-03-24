// spin_barrier_3w.mjs — Control test: spin barrier with 3 workers
//
// Same protocol as three_worker_barrier.mjs but replaces Atomics.wait
// with a pure Atomics.load spin loop. This provides correct seq_cst
// ordering and should produce 0 stale reads.
//
// Run: node spin_barrier_3w.mjs
//
// Expected: PASS — 0 stale reads.

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

const WORKER_COUNT = 3;
const ITERATIONS = 50_000;

if (isMainThread) {
    const sab = new SharedArrayBuffer(256);

    console.log('V8 Atomics.wait Visibility Bug — Spin Barrier Control');
    console.log('=====================================================');
    console.log(`Workers: ${WORKER_COUNT}  |  Iterations: ${ITERATIONS}  |  Barrier: spin (Atomics.load)`);
    console.log('');

    let done = 0;
    let totalErrors = 0;
    let totalReads = 0;
    const workers = [];

    for (let w = 0; w < WORKER_COUNT; w++) {
        const worker = new Worker(new URL(import.meta.url), {
            workerData: { sab, workerId: w, workerCount: WORKER_COUNT, iterations: ITERATIONS }
        });
        workers.push(worker);

        worker.on('message', msg => {
            if (msg.type === 'progress') {
                process.stdout.write(`\r  Iteration ${msg.iteration}/${ITERATIONS} — ${msg.staleReads} stale reads so far`);
            } else if (msg.type === 'done') {
                done++;
                totalErrors += msg.staleReads;
                totalReads += msg.totalReads;
                if (done === WORKER_COUNT) {
                    process.stdout.write('\r' + ' '.repeat(80) + '\r');
                    console.log('Results:');
                    console.log(`  Total cross-worker reads: ${totalReads}`);
                    console.log(`  Stale reads:              ${totalErrors}`);
                    console.log(`  Error rate:               ${(totalErrors / totalReads * 100).toFixed(1)}%`);
                    console.log('');
                    if (totalErrors > 0) {
                        console.log('FAIL — Spin barrier had stale reads (unexpected).');
                    } else {
                        console.log('PASS — Spin barrier provides correct happens-before ordering.');
                    }
                    workers.forEach(w => w.terminate());
                }
            }
        });
    }
} else {
    const { sab, workerId, workerCount, iterations } = workerData;
    const view = new Int32Array(sab);

    function barrier(arrivalIdx, genIdx) {
        const myGen = Atomics.load(view, genIdx);
        const arrived = Atomics.add(view, arrivalIdx, 1) + 1;
        if (arrived === workerCount) {
            Atomics.store(view, arrivalIdx, 0);
            Atomics.add(view, genIdx, 1);
            // No notify needed — waiters are spinning, not sleeping
        } else {
            while (Atomics.load(view, genIdx) === myGen) {
                // Pure spin — every Atomics.load is seq_cst, providing
                // correct happens-before when the new generation is observed
            }
        }
    }

    let staleReads = 0;
    let totalReads = 0;

    for (let iter = 0; iter < iterations; iter++) {
        view[4 + workerId] = (workerId + 1) * 1000 + iter;

        barrier(0, 1);

        for (let other = 0; other < workerCount; other++) {
            if (other === workerId) continue;
            totalReads++;
            const expected = (other + 1) * 1000 + iter;
            if (view[4 + other] !== expected) {
                staleReads++;
            }
        }

        barrier(2, 3);

        if (iter % 1000 === 0) {
            parentPort.postMessage({ type: 'progress', iteration: iter, staleReads, totalReads });
        }
    }

    parentPort.postMessage({ type: 'done', workerId, staleReads, totalReads });
}
