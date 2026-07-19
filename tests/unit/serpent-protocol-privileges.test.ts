import { describe, expect, it } from "vitest";

import {
  SERPENT_PROTOCOL_PRIVILEGES,
  SERPENT_PROTOCOL_SCHEME,
  serpentProtocolSchemes,
} from "../../src/main/serpent-protocol-privileges";

describe("serpent protocol privileges", () => {
  it("enables streaming media for seekable Range playback", () => {
    expect(SERPENT_PROTOCOL_SCHEME).toBe("serpent");
    expect(SERPENT_PROTOCOL_PRIVILEGES.stream).toBe(true);
    expect(SERPENT_PROTOCOL_PRIVILEGES.standard).toBe(true);
    expect(SERPENT_PROTOCOL_PRIVILEGES.secure).toBe(true);
    expect(SERPENT_PROTOCOL_PRIVILEGES.supportFetchAPI).toBe(true);

    const schemes = serpentProtocolSchemes();
    expect(schemes).toHaveLength(1);
    expect(schemes[0]?.scheme).toBe("serpent");
    expect(schemes[0]?.privileges.stream).toBe(true);
  });
});
