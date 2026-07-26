/**
 * F8 AI visual-analysis settings + system prompt builder.
 * See docs/development/2026-07-20-f8-ai-analysis-design-decisions.md
 */

export type AiOutputStyle = 'normal' | 'concise' | 'rigorous';

export const AI_OUTPUT_STYLES: readonly AiOutputStyle[] = [
  'normal',
  'concise',
  'rigorous',
] as const;

export const DEFAULT_AI_RATING_RUBRIC =
  '1=低质或几乎无参考价值；2=勉强可用；3=合格、常见素材；4=质量好、构图或风格突出；5=卓越、强烈推荐留用。';

export const DEFAULT_AI_DESCRIPTION_STRUCTURE =
  '先写资产类型（如：这是一张照片/一张插画/一段视频截图），再写风格与氛围，再写画面主要内容与主体。';

export const DEFAULT_AI_TAG_PROMPT =
  '标签一般是描述风格、类型、视觉特点、情绪、主题、主体等的简单词汇；若已有标签含其它类型（如职业），可仿照。';

export interface AiAnalysisSettings {
  descriptionEnabled: boolean;
  tagEnabled: boolean;
  /** Write aesthetic score into AI content layer only (never human rating). */
  ratingEnabled: boolean;
  /** When true, model may only pick from existingTagNames. */
  forceExistingTags: boolean;
  maxTags: number;
  maxDescriptionCharsZh: number;
  maxDescriptionWordsEn: number;
  outputStyle: AiOutputStyle;
  ratingRubric: string;
  /** Empty in storage = use {@link DEFAULT_AI_DESCRIPTION_STRUCTURE}. */
  customDescriptionPrompt: string;
  /** Empty in storage = use {@link DEFAULT_AI_TAG_PROMPT}. */
  customTagPrompt: string;
}

/** UI / wire value: empty persisted string resolves to the built-in rule text. */
export function resolveCustomDescriptionPromptForUi(
  value: string | null | undefined,
): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 4_000);
  }
  return DEFAULT_AI_DESCRIPTION_STRUCTURE;
}

/** UI / wire value: empty persisted string resolves to the built-in tag rule text. */
export function resolveCustomTagPromptForUi(
  value: string | null | undefined,
): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 4_000);
  }
  return DEFAULT_AI_TAG_PROMPT;
}

export const DEFAULT_AI_ANALYSIS_SETTINGS: AiAnalysisSettings = {
  descriptionEnabled: true,
  tagEnabled: true,
  ratingEnabled: true,
  forceExistingTags: false,
  maxTags: 8,
  maxDescriptionCharsZh: 100,
  maxDescriptionWordsEn: 60,
  outputStyle: 'normal',
  ratingRubric: DEFAULT_AI_RATING_RUBRIC,
  customDescriptionPrompt: DEFAULT_AI_DESCRIPTION_STRUCTURE,
  customTagPrompt: DEFAULT_AI_TAG_PROMPT,
};

export function isAiOutputStyle(value: unknown): value is AiOutputStyle {
  return (
    typeof value === 'string' &&
    (AI_OUTPUT_STYLES as readonly string[]).includes(value)
  );
}

export function normalizeAiAnalysisSettings(
  partial: Partial<AiAnalysisSettings> | null | undefined,
): AiAnalysisSettings {
  const base = DEFAULT_AI_ANALYSIS_SETTINGS;
  if (!partial) return { ...base };
  const maxTags = clampInt(partial.maxTags, 1, 32, base.maxTags);
  const maxDescriptionCharsZh = clampInt(
    partial.maxDescriptionCharsZh,
    20,
    500,
    base.maxDescriptionCharsZh,
  );
  const maxDescriptionWordsEn = clampInt(
    partial.maxDescriptionWordsEn,
    10,
    200,
    base.maxDescriptionWordsEn,
  );
  return {
    descriptionEnabled: partial.descriptionEnabled ?? base.descriptionEnabled,
    tagEnabled: partial.tagEnabled ?? base.tagEnabled,
    ratingEnabled: partial.ratingEnabled ?? base.ratingEnabled,
    forceExistingTags: partial.forceExistingTags ?? base.forceExistingTags,
    maxTags,
    maxDescriptionCharsZh,
    maxDescriptionWordsEn,
    outputStyle: isAiOutputStyle(partial.outputStyle)
      ? partial.outputStyle
      : base.outputStyle,
    ratingRubric:
      typeof partial.ratingRubric === 'string' && partial.ratingRubric.trim()
        ? partial.ratingRubric.trim().slice(0, 4_000)
        : base.ratingRubric,
    customDescriptionPrompt: resolveCustomDescriptionPromptForUi(
      partial.customDescriptionPrompt,
    ),
    customTagPrompt: resolveCustomTagPromptForUi(partial.customTagPrompt),
  };
}

/** Protocol wire shape (no field-enable flags; those travel in enabledFields). */
export type AiAnalysisSettingsWire = {
  forceExistingTags: boolean;
  maxTags: number;
  maxDescriptionCharsZh: number;
  maxDescriptionWordsEn: number;
  outputStyle: AiOutputStyle;
  ratingRubric: string;
  customDescriptionPrompt: string;
  customTagPrompt: string;
};

export function toWireAiAnalysisSettings(
  settings: AiAnalysisSettings,
): AiAnalysisSettingsWire {
  return {
    forceExistingTags: settings.forceExistingTags,
    maxTags: settings.maxTags,
    maxDescriptionCharsZh: settings.maxDescriptionCharsZh,
    maxDescriptionWordsEn: settings.maxDescriptionWordsEn,
    outputStyle: settings.outputStyle,
    ratingRubric: settings.ratingRubric,
    customDescriptionPrompt: settings.customDescriptionPrompt,
    customTagPrompt: settings.customTagPrompt,
  };
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Normalize a single advanced-setting numeric field (UI blur / wire). */
export function normalizeAiMaxTags(raw: unknown): number {
  return clampInt(raw, 1, 32, DEFAULT_AI_ANALYSIS_SETTINGS.maxTags);
}

export function normalizeAiMaxDescriptionCharsZh(raw: unknown): number {
  return clampInt(raw, 20, 500, DEFAULT_AI_ANALYSIS_SETTINGS.maxDescriptionCharsZh);
}

export function normalizeAiMaxDescriptionWordsEn(raw: unknown): number {
  return clampInt(raw, 10, 200, DEFAULT_AI_ANALYSIS_SETTINGS.maxDescriptionWordsEn);
}

const STYLE_LABEL: Record<AiOutputStyle, string> = {
  normal: '正常',
  concise: '精简',
  rigorous: '严谨',
};

export function buildAiAnalysisSystemPrompt(input: {
  language: string;
  settings: AiAnalysisSettings;
  enabledFields: {
    description: boolean;
    tags: boolean;
    rating: boolean;
  };
  existingTagNames: readonly string[];
}): string {
  const { language, settings, enabledFields, existingTagNames } = input;
  const fields: string[] = [];
  if (enabledFields.description) fields.push('description');
  if (enabledFields.tags) fields.push('tags');
  if (enabledFields.rating) fields.push('rating');

  const descriptionRules =
    settings.customDescriptionPrompt.trim() ||
    DEFAULT_AI_DESCRIPTION_STRUCTURE;

  const tagSemantics =
    settings.customTagPrompt.trim() || DEFAULT_AI_TAG_PROMPT;

  const tagRule = settings.forceExistingTags
    ? '你只能从已有标签列表中选择，不得发明新标签。'
    : '输出标签尽量使用已有标签；仅当非常特殊、重要时才新增标签。';

  const languageRule = buildTagLanguageRule(language);

  let prompt = `这是一个视觉分析任务，需要你分析资源库中一个多媒体资产的视觉特征。请分析输入图片/视频，根据风格、氛围、情绪、类型等特征，以严格 JSON 输出（不要 Markdown）。\n`;
  prompt += `JSON 形状：{"description": string|null, "tags": string[], "rating": number|null}\n`;
  prompt += `本次需要填充的字段：${fields.join(', ') || '（无）'}\n`;
  prompt += `未启用的字段请输出 null 或空数组（tags 用 []）。\n\n`;
  prompt += `你必须严格遵守：\n`;
  prompt += `+ 以「${STYLE_LABEL[settings.outputStyle]}」风格输出所有内容\n`;
  prompt += `+ 目标语言：${language}。description 与 tags[] 中每一个标签都必须使用该语言书写（Serpent-sbnt）\n`;
  prompt += `+ ${languageRule}\n`;
  prompt += `+ 只输出纯 JSON 对象，不要 Markdown 代码围栏，不要 XML/HTML 标签（例如不要写 </description>）\n`;

  if (enabledFields.tags) {
    prompt += `+ 关于标签。${tagRule}${tagSemantics}输出不超过 ${settings.maxTags} 个。每个标签的书写语言必须符合上方目标语言硬约束。\n`;
    prompt += `  已有标签（最多 100，文件夹相关优先）：[${existingTagNames.join(', ')}]\n`;
  }

  if (enabledFields.rating) {
    prompt += `+ 关于评分。必须给出 1 到 5 的整数（尽量不要 null）。评分标准：${settings.ratingRubric}\n`;
  }

  if (enabledFields.description) {
    prompt += `+ 关于描述。${descriptionRules} 中文不超过 ${settings.maxDescriptionCharsZh} 个汉字；英文不超过 ${settings.maxDescriptionWordsEn} 词。描述正文不要包含任何标签或字段名。\n`;
  }

  return prompt;
}

/** Hard language constraint for tags (and descriptions) — Serpent-sbnt. */
export function buildTagLanguageRule(language: string): string {
  const lower = language.toLowerCase();
  if (lower.includes('zh-cn') || lower.includes('chinese')) {
    return (
      '标签语言硬约束（中文）：每个标签必须是中文词语（可含数字）；' +
      '禁止输出纯拉丁字母的英文标签（例如 portrait、cyberpunk），须译成中文（人像、赛博朋克）；' +
      '唯一例外：该英文标签已原样出现在「已有标签」列表中时可原样选用'
    );
  }
  if (lower.includes('(en)') || lower === 'en' || lower.startsWith('english')) {
    return (
      'Tag language hard rule (English): every tag must be English words; ' +
      'do not emit Chinese-only tags unless that exact string already appears in the existing-tag list'
    );
  }
  if (lower.includes('ja') || lower.includes('japanese')) {
    return (
      'タグ言語の硬制約：各タグは日本語で書くこと。英語のみのタグは、既存タグ一覧にその表記がある場合を除き禁止'
    );
  }
  if (lower.includes('ko') || lower.includes('korean')) {
    return (
      '태그 언어 강제：각 태그는 한국어로 작성. 영어만으로 된 태그는 기존 태그 목록에 있을 때만 허용'
    );
  }
  return (
    `Tag language hard rule: write every tag in ${language}; ` +
    'do not use a different natural language unless that exact string is already in the existing-tag list'
  );
}

/** JSON-schema description for tags[] items (vendor adapters). */
export function aiTagsSchemaDescription(language: string): string {
  return (
    `Keyword tags for the asset. Each tag MUST be written in the target language (${language}). ` +
    'Do not emit English-only tags when the target language is Chinese (unless listed in existing tags).'
  );
}

/** Strip model-hallucinated wrappers from AI description text before persist. */
export function sanitizeAiDescription(value: string): string {
  let text = value.trim();
  if (!text) return '';
  // Fenced code blocks
  text = text.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/i, '');
  // XML/HTML-ish wrappers the model sometimes echoes from schema words
  text = text.replace(/^<\/?description>\s*/i, '').replace(/\s*<\/?description>$/i, '');
  text = text.replace(/^<\/?[a-z_][\w:-]*>\s*/i, '').replace(/\s*<\/?[a-z_][\w:-]*>$/i, '');
  return text.trim();
}
