export function parseLLMJson(text: string): any {
  const cleanText = text.trim();
  let beforeStr = "";
  let afterStr = "";

  const firstBrace = cleanText.indexOf("{");
  const firstBracket = cleanText.indexOf("[");

  let startIdx;
  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else {
    startIdx = Math.max(firstBrace, firstBracket);
  }

  const lastBrace = cleanText.lastIndexOf("}");
  const lastBracket = cleanText.lastIndexOf("]");
  const endIdx = Math.max(lastBrace, lastBracket);

  let jsonStr = cleanText;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    beforeStr = cleanText.substring(0, startIdx).trim();
    afterStr = cleanText.substring(endIdx + 1).trim();
    jsonStr = cleanText.substring(startIdx, endIdx + 1);
  }

  if (beforeStr.endsWith("```json")) beforeStr = beforeStr.substring(0, beforeStr.length - 7).trim();
  else if (beforeStr.endsWith("```")) beforeStr = beforeStr.substring(0, beforeStr.length - 3).trim();

  if (afterStr.startsWith("```")) afterStr = afterStr.substring(3).trim();

  const parsed = JSON.parse(jsonStr);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const combinedMessage: string[] = [];
    if (beforeStr) combinedMessage.push(beforeStr);
    if (parsed.message) combinedMessage.push(parsed.message);
    if (afterStr) combinedMessage.push(afterStr);

    if (combinedMessage.length > 0) {
      parsed.message = combinedMessage.join("\n\n");
    }
  }

  return parsed;
}
