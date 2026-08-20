export function shouldRefreshContentForLibraryChange(input: {
  networkStorage?: boolean;
  importing: boolean;
}): boolean {
  return input.importing || input.networkStorage === true;
}
