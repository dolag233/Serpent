import { expect, test } from "vitest";

import { DEFAULT_AI_ANALYSIS_SETTINGS } from "../../src/shared/ai-analysis-settings";
import { executeAiMainCommand } from "../../src/main/commands/ai";

test("ai.config.get stays on the Main-owned config path", () => {
  expect(executeAiMainCommand(
    { type: "ai.config.get.request" },
    {
      loadAiConfig: () => { throw new Error("unused"); },
      getDecryptedApiKey: () => { throw new Error("unused"); },
    },
  )).toBeUndefined();
});

test("ai.test-connection prefers the request api key", () => {
  expect(executeAiMainCommand(
    {
      type: "ai.test-connection.request",
      apiFormat: "openai_chat",
      model: "gpt-4o",
      apiKey: "sk-test",
    },
    {
      loadAiConfig: () => { throw new Error("unused"); },
      getDecryptedApiKey: () => { throw new Error("stored key"); },
    },
  )).toEqual({
    type: "ai.test-connection",
    apiFormat: "openai_chat",
    model: "gpt-4o",
    apiKey: "sk-test",
  });
});

test("asset.analyze maps stored config onto the worker command", () => {
  expect(executeAiMainCommand(
    {
      type: "asset.analyze.request",
      libraryId: "lib-1",
      assetId: "asset-1",
    },
    {
      loadAiConfig: () => ({
        hasKey: true,
        apiFormat: "openai_chat",
        model: "gpt-4o",
        baseUrl: "",
        descriptionEnabled: true,
        tagEnabled: false,
        ratingEnabled: false,
        analysisSettings: DEFAULT_AI_ANALYSIS_SETTINGS,
        languages: ["zh-CN"],
        maxAnalysisImageEdgePx: 2048,
      }),
      getDecryptedApiKey: () => "sk-stored",
    },
  )).toMatchObject({
    type: "asset.analyze",
    libraryId: "lib-1",
    assetId: "asset-1",
    apiFormat: "openai_chat",
    model: "gpt-4o",
    apiKey: "sk-stored",
    enabledFields: { description: true, tags: false, rating: false },
    languages: ["zh-CN"],
    maxAnalysisImageEdgePx: 2048,
  });
});
