import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { parseToolSelectionJson } from './tool-selection-json.util';
import { getGeminiApiKey } from './services/gemini-api-key.util';

const DEFAULT_TOOLS = [
  'generateImage',
  'editImage',
  'blendImages',
  'analyzeImage',
  'chatResponse',
  'generateVideo',
  'generatePaperJS'
] as const;

const TOOL_DESCRIPTIONS: Record<string, string> = {
  generateImage: '生成新的图像',
  editImage: '编辑现有图像',
  blendImages: '融合多张图像',
  analyzeImage: '分析图像内容',
  chatResponse: '文本对话或聊天',
  generateVideo: '生成视频',
  generatePaperJS: '生成 Paper.js 矢量图形代码'
};

const VECTOR_KEYWORDS = [
  '矢量',
  '矢量图',
  '矢量化',
  'vector',
  'vectorize',
  'vectorization',
  'svg',
  'paperjs',
  'paper.js',
  'svg path',
  '路径代码',
  'path code',
  'vector graphic',
  'vectorgraphics'
];

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenAI | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = getGeminiApiKey(this.config);

    if (!apiKey) {
      this.logger.warn('Google Gemini API key not configured. AI routes will be unavailable.');
      this.genAI = null;
      return;
    }

    this.genAI = new GoogleGenAI({ apiKey });
    this.logger.log('Google GenAI client initialised for server-side use.');
  }

  private ensureClient(): GoogleGenAI {
    if (!this.genAI) {
      throw new ServiceUnavailableException('Google Gemini API key not configured on the server.');
    }
    return this.genAI;
  }

  private normalizeTools(availableTools?: string[], allowVector: boolean = true): string[] {
    const baseTools = Array.isArray(availableTools) && availableTools.length
      ? availableTools
      : [...DEFAULT_TOOLS];
    const uniqueTools = Array.from(new Set(baseTools.filter(Boolean)));

    const filtered = allowVector
      ? uniqueTools
      : uniqueTools.filter((tool) => tool !== 'generatePaperJS');

    if (filtered.length > 0) {
      return filtered;
    }

    // 确保至少返回一个安全工具
    return allowVector ? [...DEFAULT_TOOLS] : [...DEFAULT_TOOLS.filter((tool) => tool !== 'generatePaperJS')];
  }

  private hasVectorIntent(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return VECTOR_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
  }

  private formatToolList(tools: string[]): string {
    return tools
      .map((tool) => {
        const description = TOOL_DESCRIPTIONS[tool] || '辅助对话';
        return `- ${tool}: ${description}`;
      })
      .join('\n');
  }

  async runToolSelectionPrompt(
    prompt: string,
    availableTools?: string[]
  ): Promise<{ selectedTool: string; parameters: { prompt: string }; reasoning?: string; confidence?: number }> {
    if (!prompt || !prompt.trim()) {
      throw new BadRequestException('Tool selection prompt is empty.');
    }

    const client = this.ensureClient();
    const maxAttempts = 3;
    const delayMs = 1000;
    let lastError: unknown;

    const hasVectorIntent = this.hasVectorIntent(prompt);
    const tools = this.normalizeTools(availableTools, hasVectorIntent);
    const toolListText = this.formatToolList(tools);

    const vectorRule = tools.includes('generatePaperJS')
      ? `只有当用户明确提到以下关键词之一（${VECTOR_KEYWORDS.join(', ')}）或直接要求输出 SVG/Paper.js 矢量代码时，才选择 generatePaperJS；仅描述形状、几何或线条但未出现这些关键词时，不要选择 generatePaperJS，优先 generateImage 或 chatResponse。`
      : '';

    // 工具选择的系统提示
    const systemPrompt = `你是一个AI助手工具选择器。根据用户的输入，选择最合适的工具执行。

可用工具:
${toolListText}

${vectorRule ? `${vectorRule}\n\n` : ''}请根据用户的实际需求，智能判断最合适的工具。例如：
- 用户明确提到“矢量”“vector”“svg”“paperjs”等关键词，或要求输出矢量代码 → generatePaperJS
- 用户要求生成图像、照片、画作等 → generateImage
- 用户要求编辑、修改现有图像 → editImage
- 用户要求融合、混合多张图像 → blendImages
- 用户要求分析、识别图像内容 → analyzeImage
- 用户要求生成视频 → generateVideo
- 其他对话、提问、讨论 → chatResponse

请以以下JSON格式回复（仅返回JSON，不要其他文字）:
{
  "selectedTool": "工具名称",
  "reasoning": "选择理由",
  "confidence": 0.0-1.0
}`;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const response = await client.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: [
                { text: systemPrompt },
                { text: `用户输入: ${prompt}` }
              ],
              config: {
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
              { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
          },
        });

        if (!response.text) {
          this.logger.warn('Tool selection response did not contain text. Full response omitted.');
          throw new Error('Empty Gemini response');
        }

        // 解析AI的JSON响应
        try {
          const parsed = parseToolSelectionJson(response.text);

          if (!parsed || typeof parsed !== 'object') {
            throw new Error('Invalid tool selection JSON');
          }

          const rawSelected = typeof parsed.selectedTool === 'string' ? parsed.selectedTool : 'chatResponse';
          const selectedTool =
            tools.includes(rawSelected) ? rawSelected : (tools.includes('chatResponse') ? 'chatResponse' : tools[0]);

          this.logger.log(`Tool selected: ${selectedTool}`, { hasVectorIntent });

          return {
            selectedTool,
            parameters: { prompt },
            reasoning:
              typeof parsed.reasoning === 'string'
                ? parsed.reasoning
                : TOOL_DESCRIPTIONS[selectedTool] || '自动选择最合适的工具。',
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85
          };
        } catch (parseError) {
          this.logger.warn(`Failed to parse tool selection JSON: ${response.text}`);
          // 降级：如果解析失败，默认返回文本对话
          return {
            selectedTool: tools.includes('chatResponse') ? 'chatResponse' : tools[0],
            parameters: { prompt },
            reasoning: 'Fallback due to invalid JSON response',
            confidence: 0.5
          };
        }
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Tool selection attempt ${attempt}/${maxAttempts} failed: ${message}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Unknown error occurred during tool selection.';
    this.logger.error(`All tool selection attempts failed: ${message}`);

    // 最后的降级方案：返回文本对话
    return {
      selectedTool: tools.includes('chatResponse') ? 'chatResponse' : tools[0],
      parameters: { prompt },
      reasoning: 'Fallback due to repeated failures',
      confidence: 0.4
    };
  }
}
