import { serverConfig } from '../config';

interface GeminiResponse { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } }

function getApiKey(): string {
  const { getSetting } = require('../db') as typeof import('../db');
  const { decryptSecret } = require('../crypto') as typeof import('../crypto');
  const stored = getSetting('gemini_api_key');
  return stored ? (decryptSecret(stored) || '') : serverConfig.geminiApiKey;
}

export function getGeminiModel(): string {
  const { getSetting } = require('../db') as typeof import('../db');
  return getSetting('gemini_model') || serverConfig.geminiModel;
}

export async function generateCaption(input: string, action: 'generate' | 'rewrite' | 'shorten' | 'variant'): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Gemini chưa được cấu hình. Hãy nhập API Key trong phần Cài đặt hoặc dùng chế độ viết thủ công.');
  const actionInstruction = {
    generate: 'Viết một bài bán hàng hoàn chỉnh từ thông tin đầu vào.',
    rewrite: 'Viết lại bài bán hàng tự nhiên hơn nhưng giữ nguyên dữ kiện.',
    shorten: 'Rút gọn bài bán hàng, giữ lại thông tin quan trọng và lời kêu gọi hành động.',
    variant: 'Tạo một phiên bản khác với cách diễn đạt mới, không bịa thêm dữ kiện.'
  }[action];
  const prompt = `Bạn là trợ lý viết nội dung bán hàng bằng tiếng Việt. ${actionInstruction}
Quy tắc bắt buộc:
- Giữ nguyên chính xác tên sản phẩm, giá, số lượng và mọi dữ kiện người dùng cung cấp.
- Không bịa giá, khuyến mãi, nguồn gốc, chứng nhận, công dụng hay cam kết giao hàng.
- Có thể dùng emoji vừa phải và hashtag phù hợp nhưng không lạm dụng.
- Chỉ trả về nội dung bài đăng, không giải thích quy trình.

Thông tin/bài hiện tại của người dùng:
${input}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getGeminiModel())}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.65, maxOutputTokens: 1000 } })
  });
  const data = await response.json() as GeminiResponse;
  if (!response.ok) throw new Error(data.error?.message || `Gemini trả về HTTP ${response.status}.`);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini không trả về nội dung.');
  return text;
}

export async function testGemini(apiKeyOverride?: string): Promise<{ model: string; message: string }> {
  const key = apiKeyOverride || getApiKey();
  if (!key) throw new Error('Chưa có Gemini API Key.');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getGeminiModel())}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Trả lời đúng một từ: OK' }] }], generationConfig: { maxOutputTokens: 5 } })
  });
  const data = await response.json() as GeminiResponse;
  if (!response.ok) throw new Error(data.error?.message || `Gemini trả về HTTP ${response.status}.`);
  return { model: getGeminiModel(), message: 'Kết nối Gemini thành công.' };
}
