import { describe, expect, it } from 'vitest';

import {
  buildAiAnalysisSystemPrompt,
  DEFAULT_AI_ANALYSIS_SETTINGS,
  normalizeAiAnalysisSettings,
  sanitizeAiDescription,
  toWireAiAnalysisSettings,
} from '../../src/shared/ai-analysis-settings';

describe('normalizeAiAnalysisSettings', () => {
  it('clamps numeric bounds and defaults missing fields', () => {
    const settings = normalizeAiAnalysisSettings({
      maxTags: 99,
      maxDescriptionCharsZh: 5,
      maxDescriptionWordsEn: 500,
      outputStyle: 'nope' as 'normal',
      forceExistingTags: true,
    });
    expect(settings.maxTags).toBe(32);
    expect(settings.maxDescriptionCharsZh).toBe(20);
    expect(settings.maxDescriptionWordsEn).toBe(200);
    expect(settings.outputStyle).toBe('normal');
    expect(settings.forceExistingTags).toBe(true);
  });
});

describe('toWireAiAnalysisSettings', () => {
  it('omits field-enable flags from the wire payload', () => {
    const wire = toWireAiAnalysisSettings(DEFAULT_AI_ANALYSIS_SETTINGS);
    expect(wire).toEqual({
      forceExistingTags: false,
      maxTags: 8,
      maxDescriptionCharsZh: 100,
      maxDescriptionWordsEn: 60,
      outputStyle: 'normal',
      ratingRubric: DEFAULT_AI_ANALYSIS_SETTINGS.ratingRubric,
      customDescriptionPrompt: '',
    });
    expect(wire).not.toHaveProperty('descriptionEnabled');
  });
});

describe('buildAiAnalysisSystemPrompt', () => {
  it('includes force-existing-tag rule and rating rubric when enabled', () => {
    const prompt = buildAiAnalysisSystemPrompt({
      language: 'zh-CN, en',
      settings: {
        ...DEFAULT_AI_ANALYSIS_SETTINGS,
        forceExistingTags: true,
        maxTags: 5,
      },
      enabledFields: { description: true, tags: true, rating: true },
      existingTagNames: ['角色', '场景'],
    });
    expect(prompt).toContain('只能从已有标签列表中选择');
    expect(prompt).toContain('不超过 5 个');
    expect(prompt).toContain('角色, 场景');
    expect(prompt).toContain(DEFAULT_AI_ANALYSIS_SETTINGS.ratingRubric);
    expect(prompt).toContain('"rating"');
  });

  it('omits tag and rating sections when those fields are disabled', () => {
    const prompt = buildAiAnalysisSystemPrompt({
      language: 'en',
      settings: DEFAULT_AI_ANALYSIS_SETTINGS,
      enabledFields: { description: true, tags: false, rating: false },
      existingTagNames: ['unused'],
    });
    expect(prompt).toContain('description');
    expect(prompt).not.toContain('关于标签');
    expect(prompt).not.toContain('关于评分');
  });

  it('hard-constrains Chinese tags when language is zh-CN (Serpent-sbnt)', () => {
    const prompt = buildAiAnalysisSystemPrompt({
      language: 'Chinese (zh-CN)',
      settings: DEFAULT_AI_ANALYSIS_SETTINGS,
      enabledFields: { description: true, tags: true, rating: false },
      existingTagNames: [],
    });
    expect(prompt).toContain('标签语言硬约束');
    expect(prompt).toContain('禁止输出纯拉丁字母的英文标签');
    expect(prompt).toContain('每一个标签都必须使用该语言');
  });
});

describe('sanitizeAiDescription', () => {
  it('strips trailing description XML tags and fences', () => {
    expect(sanitizeAiDescription('城市夜景</description>')).toBe('城市夜景');
    expect(sanitizeAiDescription('<description>城市夜景</description>')).toBe(
      '城市夜景',
    );
    expect(sanitizeAiDescription('```\n城市夜景\n```')).toBe('城市夜景');
  });
});
