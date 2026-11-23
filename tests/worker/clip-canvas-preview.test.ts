import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { extractClipCanvasPreview } from '../../src/worker/clip-canvas-preview';

const Database = BetterSqlite3 as new (filename: string) => {
  exec(source: string): void;
  prepare(source: string): { run(value: Buffer): unknown };
  serialize(): Buffer;
  close(): void;
};

const ONE_PIXEL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cf0000000301010018dd8db40000000049454e44ae426082',
  'hex',
);

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-clip-'));
  temporaryRoots.push(root);
  return root;
}

function sqliteWithPreview(image: Buffer): Buffer {
  const database = new Database(':memory:');
  database.exec(
    'CREATE TABLE CanvasPreview (ImageData BLOB, ImageWidth INTEGER, ImageHeight INTEGER)',
  );
  database.prepare(
    'INSERT INTO CanvasPreview (ImageData, ImageWidth, ImageHeight) VALUES (?, 1, 1)',
  ).run(image);
  const bytes = database.serialize();
  database.close();
  return bytes;
}

function uint64(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function chunk(tag: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from(tag, 'ascii'), uint64(payload.length), payload]);
}

function clipContainer(database: Buffer): Buffer {
  const body = Buffer.concat([
    chunk('CHNKHead', Buffer.alloc(40)),
    chunk('CHNKSQLi', database),
    chunk('CHNKFoot', Buffer.alloc(0)),
  ]);
  return Buffer.concat([
    Buffer.from('CSFCHUNK', 'ascii'),
    uint64(24 + body.length),
    uint64(24),
    body,
  ]);
}

describe('extractClipCanvasPreview', () => {
  it('reads the preview stored in a CHNKSQLi chunk', () => {
    const root = temporaryRoot();
    const filePath = path.join(root, 'drawing.clip');
    writeFileSync(filePath, clipContainer(sqliteWithPreview(ONE_PIXEL_PNG)));

    expect(extractClipCanvasPreview(filePath)?.equals(ONE_PIXEL_PNG)).toBe(true);
  });

  it('reads a file that is the SQLite database itself', () => {
    const root = temporaryRoot();
    const filePath = path.join(root, 'page.clip');
    writeFileSync(filePath, sqliteWithPreview(ONE_PIXEL_PNG));

    expect(extractClipCanvasPreview(filePath)?.equals(ONE_PIXEL_PNG)).toBe(true);
  });

  it('returns null when the database has no preview image', () => {
    const root = temporaryRoot();
    const database = new Database(':memory:');
    database.exec('CREATE TABLE CanvasPreview (ImageData BLOB)');
    const bytes = database.serialize();
    database.close();
    const filePath = path.join(root, 'empty.clip');
    writeFileSync(filePath, clipContainer(bytes));

    expect(extractClipCanvasPreview(filePath)).toBeNull();
  });
});
