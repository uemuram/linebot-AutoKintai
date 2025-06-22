import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Geminiにリクエストを投げる
export async function askGemini(_prompt) {
  // For text-only input, use the gemini-pro model
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash"});

  const prompt = _prompt;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();
  return text;
}