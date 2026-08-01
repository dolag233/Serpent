async function activate(serpent) {
  const session = await serpent.input.capture({
    scope: "application",
    keyboard: true,
    pointer: false,
  });
  let count = 0;
  try {
    for await (const event of session.events) {
      await serpent.storage.set("input-capture-" + String(count), event);
      count += 1;
      if (count >= 8) break;
    }
  } finally {
    session.release();
    await serpent.storage.set("input-capture-count", count);
  }
}
