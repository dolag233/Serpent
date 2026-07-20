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
  /** Empty = use default type→style→content structure. */
  customDescriptionPrompt: string;
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
  customDescriptionPrompt: '',
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
    customDescriptionPrompt:
      typeof partial.customDescriptionPrompt === 'string'
        ? partial.customDescriptionPrompt.trim().slice(0, 4_000)
        : '',
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
  };
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
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

  const tagRule = settings.forceExistingTags
    ? '你只能从已有标签列表中选择，不得发明新标签。'
    : '输出标签尽量使用已有标签；仅当非常特殊、重要时才新增标签。';

  let prompt = `这是一个视觉分析任务，需要你分析资源库中一个多媒体资产的视觉特征。请分析输入图片/视频，根据风格、氛围、情绪、类型等特征，以严格 JSON 输出（不要 Markdown）。\n`;
  prompt += `JSON 形状：{"description": string|null, "tags": string[], "rating": number|null}\n`;
  prompt += `本次需要填充的字段：${fields.join(', ') || '（无）'}\n`;
  prompt += `未启用的字段请输出 null 或空数组（tags 用 []）。\n\n`;
  prompt += `你必须严格遵守：\n`;
  prompt += `+ 以「${STYLE_LABEL[settings.outputStyle]}」风格输出所有内容\n`;
  prompt += `+ 目标语言：${language}。描述与标签必须使用该语言\n`;
  prompt += `+ 只输出纯 JSON 对象，不要 Markdown 代码围栏，不要 XML/HTML 标签（例如不要写 </description>）\n`;

  if (enabledFields.tags) {
    prompt += `+ 关于标签。${tagRule}标签一般是描述风格、类型、视觉特点、情绪、主题、主体等的简单词汇；若已有标签含其它类型（如职业），可仿照。输出不超过 ${settings.maxTags} 个。\n`;
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
