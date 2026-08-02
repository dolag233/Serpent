/**
 * The initial Desktop Console example is deliberately a real, useful
 * automation: it uses the public search grammar, pages through every match,
 * and keeps each metadata-write request comfortably below its 10,000-item
 * transport limit. Keep it separate from the Dialog so the exact user-facing
 * script is covered by the Worker-runtime test.
 */
export const DEFAULT_AUTOMATION_RATING_SCRIPT = `const matchingIds = [];
let offset = 0;

while (true) {
  const page = await serpent.assets.search({ query: 'name:Ser | tag:Ser', limit: 200, offset });
  matchingIds.push(...page.items.map((asset) => asset.id));
  if (!page.hasMore || page.items.length === 0) break;
  offset += page.items.length;
}

const batches = [];
for (let index = 0; index < matchingIds.length; index += 500) {
  batches.push(await serpent.assets.setRating(matchingIds.slice(index, index + 500), 4));
}

const result = {
  matched: matchingIds.length,
  updatedCount: batches.reduce((count, batch) => count + batch.updatedCount, 0),
  skipped: batches.flatMap((batch) => batch.skipped),
};
console.log(result);
return result;`;
