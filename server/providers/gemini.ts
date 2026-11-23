import { serverConfig } from '../config';
import { getSetting } from '../db';
import { decryptSecret } from '../crypto';

interface GeminiResponse { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } }

function getApiKey(): string {
  const stored = getSetting('gemini_api_key');
  return stored ? (decryptSecret(stored) || serverConfig.geminiApiKey) : serverConfig.geminiApiKey;
}

export function getGeminiModel(): string {
  return getSetting('gemini_model') || serverConfig.geminiModel;
}

async function callGemini(key: string, body: unknown, timeout = 60_000): Promise<GeminiResponse> {
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(getGeminiModel())}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('Gemini phản hồi quá lâu. Vui lòng thử lại.');
    throw new Error('Không kết nối được Gemini. Kiểm tra mạng và API Key.');
  }
  const data = await response.json().catch(() => ({})) as GeminiResponse;
  if (!response.ok) throw new Error(data.error?.message || `Gemini trả về HTTP ${response.status}.`);
  return data;
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
  const data = await callGemini(apiKey, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.65, maxOutputTokens: 1000 } });
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini không trả về nội dung.');
  return text;
}

export async function testGemini(apiKeyOverride?: string): Promise<{ model: string; message: string }> {
  const key = apiKeyOverride || getApiKey();
  if (!key) throw new Error('Chưa có Gemini API Key.');
  const data = await callGemini(key, { contents: [{ parts: [{ text: 'Trả lời đúng một từ: OK' }] }], generationConfig: { maxOutputTokens: 10 } }, 30_000);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini phản hồi nhưng không có nội dung xác nhận.');
  return { model: getGeminiModel(), message: 'Kết nối Gemini thành công.' };
}
