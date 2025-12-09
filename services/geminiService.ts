import { GoogleGenAI, Type } from "@google/genai";
import { GEMINI_MODEL_NAME } from "../constants";
import { AnalysisResult } from "../types";

export const generateVideoAnalysis = async (base64Image: string): Promise<AnalysisResult> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please check your environment configuration.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const prompt = "Analyze this screenshot from a screen recording. Provide a catchy title, a concise summary of what is visible, and 3-5 relevant tags.";

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "A creative title for the recording" },
            summary: { type: Type.STRING, description: "A 1-2 sentence summary of the visual content" },
            tags: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "3-5 relevant keywords" 
            },
          },
          required: ["title", "summary", "tags"],
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) {
      throw new Error("No response from Gemini.");
    }
    
    return JSON.parse(jsonText) as AnalysisResult;
  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    throw error;
  }
};
