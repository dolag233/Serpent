import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractAuthorFromExif, type ExifParser } from "../../src/worker/author-from-exif";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function temporaryFile(name: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "serpent-exif-test-"));
  temporaryRoots.push(root);
  return path.join(root, name);
}

/** Build a minimal (non-decodable) JPEG containing only an EXIF APP1 segment with an Artist tag. */
function buildExifArtistJpeg(artist: string): Buffer {
  const artistBytes = Buffer.from(`${artist}\0`, "ascii");
  const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
  const ifdEntryCount = Buffer.alloc(2);
  ifdEntryCount.writeUInt16LE(1, 0);
  const entry = Buffer.alloc(12);
  entry.writeUInt16LE(0x013b, 0); // Artist tag
  entry.writeUInt16LE(2, 2); // ASCII type
  entry.writeUInt32LE(artistBytes.length, 4);
  const dataOffset = 8 + 2 + 12 + 4;
  entry.writeUInt32LE(dataOffset, 8);
  const nextIfdOffset = Buffer.alloc(4);
  const tiff = Buffer.concat([tiffHeader, ifdEntryCount, entry, nextIfdOffset, artistBytes]);
  const exifHeader = Buffer.from("Exif\0\0", "ascii");
  const app1Data = Buffer.concat([exifHeader, tiff]);
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(app1Data.length + 2, 0);
  const app1Segment = Buffer.concat([Buffer.from([0xff, 0xe1]), lenBuf, app1Data]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1Segment,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Build a minimal JPEG containing only an IPTC By-line (record 2, dataset 80) inside an APP13/Photoshop segment. */
function buildIptcBylineJpeg(byline: string): Buffer {
  const data = Buffer.from(byline, "utf-8");
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(data.length, 0);
  const iimRecord = Buffer.concat([Buffer.from([0x1c, 0x02, 0x50]), lenBuf, data]);
  const namePascal = Buffer.from([0x00, 0x00]);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(iimRecord.length, 0);
  const paddedData = iimRecord.length % 2 === 0 ? iimRecord : Buffer.concat([iimRecord, Buffer.from([0x00])]);
  const idBuf = Buffer.from([0x04, 0x04]);
  const block = Buffer.concat([Buffer.from("8BIM", "ascii"), idBuf, namePascal, sizeBuf, paddedData]);
  const psHeader = Buffer.from("Photoshop 3.0\0", "ascii");
  const app13Data = Buffer.concat([psHeader, block]);
  const app13Length = Buffer.alloc(2);
  app13Length.writeUInt16BE(app13Data.length + 2, 0);
  const app13Segment = Buffer.concat([Buffer.from([0xff, 0xed]), app13Length, app13Data]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app13Segment,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Build a minimal JPEG containing only an XMP dc:creator packet. */
function buildXmpCreatorJpeg(creator: string): Buffer {
  const xmpXml = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:creator>
    <rdf:Seq>
     <rdf:li>${creator}</rdf:li>
    </rdf:Seq>
   </dc:creator>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const xmpHeader = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "ascii");
  const xmpBody = Buffer.from(xmpXml, "utf-8");
  const app1Data = Buffer.concat([xmpHeader, xmpBody]);
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(app1Data.length + 2, 0);
  const app1Segment = Buffer.concat([Buffer.from([0xff, 0xe1]), lenBuf, app1Data]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1Segment,
    Buffer.from([0xff, 0xd9]),
  ]);
}

describe("extractAuthorFromExif with the real exifr parser", () => {
  it("reads the legacy EXIF Artist tag", async () => {
    const filePath = temporaryFile("artist.jpg");
    writeFileSync(filePath, buildExifArtistJpeg("Jane Doe"));

    await expect(extractAuthorFromExif(filePath)).resolves.toBe("Jane Doe");
  });

  it("reads the IPTC By-line tag", async () => {
    const filePath = temporaryFile("byline.jpg");
    writeFileSync(filePath, buildIptcBylineJpeg("John Smith"));

    await expect(extractAuthorFromExif(filePath)).resolves.toBe("John Smith");
  });

  it("reads the XMP dc:creator field", async () => {
    const filePath = temporaryFile("creator.jpg");
    writeFileSync(filePath, buildXmpCreatorJpeg("Alice XMP"));

    await expect(extractAuthorFromExif(filePath)).resolves.toBe("Alice XMP");
  });

  it("returns null when no author metadata is present", async () => {
    const filePath = temporaryFile("plain.jpg");
    writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    await expect(extractAuthorFromExif(filePath)).resolves.toBeNull();
  });

  it("returns null instead of throwing for a nonexistent file", async () => {
    await expect(
      extractAuthorFromExif("/nonexistent/does-not-exist.jpg"),
    ).resolves.toBeNull();
  });
});

describe("extractAuthorFromExif field precedence and normalization (mocked parser)", () => {
  function mockParser(output: unknown): ExifParser {
    return { parse: async () => output };
  }

  it("prefers XMP creator over IPTC Byline and EXIF Artist", async () => {
    const parser = mockParser({ creator: "XMP Wins", Byline: "IPTC", Artist: "EXIF" });
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBe("XMP Wins");
  });

  it("prefers IPTC Byline over EXIF Artist when XMP is absent", async () => {
    const parser = mockParser({ Byline: "IPTC Wins", Artist: "EXIF" });
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBe("IPTC Wins");
  });

  it("falls back to EXIF Artist when nothing else is present", async () => {
    const parser = mockParser({ Artist: "EXIF Wins" });
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBe("EXIF Wins");
  });

  it("unwraps an XMP array-valued creator field to its first entry", async () => {
    const parser = mockParser({ creator: ["First Author", "Second Author"] });
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBe("First Author");
  });

  it("skips blank/whitespace-only candidates and falls through to the next field", async () => {
    const parser = mockParser({ creator: "   ", Artist: "Fallback" });
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBe("Fallback");
  });

  it("trims surrounding whitespace", async () => {
    const parser = mockParser({ Artist: "  Padded Name  " });
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBe("Padded Name");
  });

  it("returns null when the parser output has no recognizable field", async () => {
    const parser = mockParser({ SomeOtherTag: "value" });
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBeNull();
  });

  it("returns null when the parser throws", async () => {
    const parser: ExifParser = { parse: async () => { throw new Error("boom"); } };
    await expect(extractAuthorFromExif("irrelevant.jpg", parser)).resolves.toBeNull();
  });

  it("caps an overlong author to 255 characters", async () => {
    const long = "A".repeat(400);
    const parser = mockParser({ Artist: long });
    const result = await extractAuthorFromExif("irrelevant.jpg", parser);
    expect(result).toHaveLength(255);
    expect(result).toBe(long.slice(0, 255));
  });
});
