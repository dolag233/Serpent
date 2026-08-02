async function setup(serpent) {
  serpent.jobs.registerHandler('tick', async (payload) => {
    await serpent.storage.set('job-tick', payload);
  });
  await serpent.jobs.enqueue({
    handlerId: 'tick',
    payload: { tick: 1 },
  });
}

async function dispose() {}

void setup;
void dispose;
