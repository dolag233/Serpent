async function setup(serpent) {
  await serpent.storage.set('setup-started', true);
  serpent.jobs.registerHandler('tick', async (payload) => {
    const storedAttempts = await serpent.storage.get('job-attempts');
    const attempts = Number(storedAttempts ?? 0);
    await serpent.storage.set('job-attempts', attempts + 1);
    // The first execution intentionally remains in flight. The E2E test kills
    // the entire application, then verifies that the unfinished job remains
    // interrupted and that a later explicit command can enqueue a new job.
    if (attempts === 0) {
      await new Promise(() => {});
    }
    await serpent.storage.set('job-tick', payload);
  });
  serpent.commands.register('start', async () => {
    await enqueueJob(serpent);
  });
}

async function enqueueJob(serpent) {
  await serpent.jobs.enqueue({
    handlerId: 'tick',
    payload: { tick: 1 },
  });
}

async function dispose() {}

void setup;
void dispose;
