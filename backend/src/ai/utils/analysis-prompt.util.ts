export interface AnalysisPromptInput {
  mimeType: string;
}

export function buildAnalysisPrompt(
  prompt: string | undefined,
  inputs: AnalysisPromptInput[],
): string {
  const normalizedPrompt =
    typeof prompt === 'string' ? prompt.trim() : '';
  const hasPdf = inputs.some((item) => item.mimeType === 'application/pdf');
  const hasImage = inputs.some((item) => item.mimeType.startsWith('image/'));
  const isMultiFile = inputs.length > 1;

  if (normalizedPrompt) {
    if (isMultiFile) {
      return `请分析这些文件，使用中文回答：\n\n${normalizedPrompt}`;
    }

    return hasPdf && !hasImage
      ? `请分析这份 PDF，使用中文回答：\n\n${normalizedPrompt}`
      : `请分析这份文件，使用中文回答：\n\n${normalizedPrompt}`;
  }

  if (isMultiFile) {
    return `请详细分析这些文件，使用中文回答：
1. 各文件的主题与核心内容
2. 文件之间的联系、差异或互补信息
3. 关键数据、图表、对象或细节
4. 可直接提炼的结论与后续可用信息`;
  }

  if (hasPdf && !hasImage) {
    return `请详细分析这份 PDF 文档，使用中文回答：
1. 文档类型和用途
2. 主要内容摘要
3. 关键数据和重点信息
4. 结构和章节组织
5. 值得注意的细节`;
  }

  return `请详细分析这份图片文件，使用中文回答：
1. 主体内容
2. 场景、人物或物体
3. 风格与构图
4. 质量与细节
5. 可提炼的信息`;
}
