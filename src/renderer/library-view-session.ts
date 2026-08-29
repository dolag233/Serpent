/**
 * Identity fence for renderer state that belongs to one open library.
 *
 * A library id alone is not enough: an old request can resolve after the same
 * library has been closed and reopened, or after another library was made
 * active. The monotonically increasing generation makes every replacement a
 * new renderer session.
 */
export type LibraryViewSession = Readonly<{
  libraryId: string | null;
  generation: number;
}>;

export type LibraryViewSessionToken = Readonly<{
  libraryId: string;
  generation: number;
}>;

export function advanceLibraryViewSession(
  current: LibraryViewSession,
  libraryId: string | null,
): LibraryViewSession {
  return {
    libraryId,
    generation: current.generation + 1,
  };
}

export function invalidateLibraryViewSession(
  current: LibraryViewSession,
): LibraryViewSession {
  return advanceLibraryViewSession(current, current.libraryId);
}

export function isCurrentLibraryViewSession(
  current: LibraryViewSession,
  token: LibraryViewSessionToken,
): boolean {
  return (
    current.libraryId === token.libraryId &&
    current.generation === token.generation
  );
}
