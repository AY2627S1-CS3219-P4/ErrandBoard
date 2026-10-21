import { Queue, Worker, type Worker as TWorker } from "bullmq";
import { bullConnection } from "./connection.js";
import { runLifecycleSweep } from "./sweep.js";

const QUEUE = "errand-lifecycle";
const JOB = "sweep";

let queue: Queue | undefined;
let worker: TWorker | undefined;

const LIFECYCLE_SWEEP_MS = 20000 // sweep job runs every 20s

export async function startLifecycle() {
  queue = new Queue(QUEUE, { connection: bullConnection });

  await queue.upsertJobScheduler('sweep-every-20s',
    { every: LIFECYCLE_SWEEP_MS },
    {
      name: JOB,
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 100 },
    },
  );

  worker = new Worker(QUEUE, async () => { 
    await runLifecycleSweep();
  }, 
  {
    connection: bullConnection,
    concurrency: 1,             // one tick at a time
  });

  worker.on("failed", (job, err) => console.error("lifecycle sweep failed:", err));
}

export async function stopLifecycle() {
  await worker?.close();
  await queue?.close();
}
