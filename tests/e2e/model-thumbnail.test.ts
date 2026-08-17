import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const TRIANGLE_BINARY_BASE64 =
  "AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAABAAIA";

function padToFourBytes(bytes: Buffer, fill: number): Buffer {
  const paddedLength = (bytes.length + 3) & ~3;
  return Buffer.concat([bytes, Buffer.alloc(paddedLength - bytes.length, fill)]);
}

function triangleBinary(): Buffer {
  return Buffer.from(TRIANGLE_BINARY_BASE64, "base64");
}

function writeTriangleGltfBundle(temporaryRoot: string): string[] {
  const gltfPath = path.join(temporaryRoot, "triangle.gltf");
  const bufferPath = path.join(temporaryRoot, "triangle.bin");
  const gltf = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "models", "triangle.gltf"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  gltf.buffers = [{ uri: "triangle.bin", byteLength: 42 }];
  writeFileSync(gltfPath, JSON.stringify(gltf));
  writeFileSync(bufferPath, triangleBinary());
  return [gltfPath, bufferPath];
}

function writeTriangleGlb(targetPath: string): void {
  const gltf = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "tests", "fixtures", "models", "triangle.gltf"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  gltf.buffers = [{ byteLength: 42 }];

  const jsonChunk = padToFourBytes(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const binaryChunk = padToFourBytes(triangleBinary(), 0);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  writeFileSync(
    targetPath,
    Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]),
  );
}

function fixtureModels(name: string): string {
  return path.join(process.cwd(), "tests", "fixtures", "models", name);
}

async function assertDecodedModelThumbnail(input: {
  temporaryRoot: string;
  libraryName: string;
  modelFiles: string[];
  assetName: string;
}): Promise<void> {
  const { temporaryRoot, libraryName, modelFiles, assetName } = input;
  const libraryPath = path.join(temporaryRoot, libraryName);
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: modelFiles.join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const assetCard = window
      .locator(".asset-card")
      .filter({ hasText: assetName });
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    const thumbnail = assetCard.locator("img.asset-thumbnail");
    await expect
      .poll(
        async () =>
          thumbnail.evaluate((element) => {
            const image = element as HTMLImageElement;
            return {
              complete: image.complete,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            };
          }),
        { timeout: 75_000 },
      )
      .toMatchObject({
        complete: true,
        naturalWidth: expect.any(Number),
        naturalHeight: expect.any(Number),
      });
    await expect
      .poll(async () =>
        thumbnail.evaluate((element) => (element as HTMLImageElement).naturalWidth > 0),
      )
      .toBe(true);
  } finally {
    await application.close();
  }
}

test("renders and decodes a model thumbnail after import", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-model-thumbnail-e2e-"),
  );
  console.log(`[model-thumbnail-e2e-root] ${temporaryRoot}`);
  await assertDecodedModelThumbnail({
    temporaryRoot,
    libraryName: "模型缩略图验收",
    modelFiles: [
      fixtureModels("cube.obj"),
      fixtureModels("cube.mtl"),
    ],
    assetName: "cube.obj",
  });
});

const modelThumbnailCases: readonly {
  name: string;
  assetName: string;
  createFiles(temporaryRoot: string): string[];
}[] = [
  {
    name: "glTF",
    assetName: "triangle.gltf",
    createFiles: writeTriangleGltfBundle,
  },
  {
    name: "GLB",
    assetName: "triangle.glb",
    createFiles: (temporaryRoot) => {
      const targetPath = path.join(temporaryRoot, "triangle.glb");
      writeTriangleGlb(targetPath);
      return [targetPath];
    },
  },
  {
    name: "STL",
    assetName: "triangle.stl",
    createFiles: () => [fixtureModels("triangle.stl")],
  },
  {
    name: "FBX",
    assetName: "blender_272_cube_7400_binary.fbx",
    createFiles: () => [
      path.join(
        process.cwd(),
        "tests",
        "fixtures",
        "fbx",
        "blender_272_cube_7400_binary.fbx",
      ),
    ],
  },
];

for (const modelThumbnailCase of modelThumbnailCases) {
  test(`renders and decodes a ${modelThumbnailCase.name} thumbnail`, async () => {
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), `serpent-model-thumbnail-${modelThumbnailCase.name.toLowerCase()}-`),
    );
    await assertDecodedModelThumbnail({
      temporaryRoot,
      libraryName: `模型缩略图-${modelThumbnailCase.name}`,
      modelFiles: modelThumbnailCase.createFiles(temporaryRoot),
      assetName: modelThumbnailCase.assetName,
    });
  });
}
