import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey! });

export interface SentimentAnalysis {
  score: number;
  label: string;
  summary: string;
  analysis: string;
  moodScore: number;
}

export async function analyzeJournalEntry(content: string): Promise<SentimentAnalysis> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the following journal entry deeply. Provide a sentiment score (-1 to 1), a label (Positive, Negative, Neutral, etc.), a short summary, a deep analysis of the underlying emotions, and a mood score (1-10).
    
    Entry: "${content}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER, description: "Sentiment score from -1 to 1." },
          label: { type: Type.STRING, description: "Sentiment label." },
          summary: { type: Type.STRING, description: "Short summary of the entry." },
          analysis: { type: Type.STRING, description: "Deep emotional analysis." },
          moodScore: { type: Type.INTEGER, description: "Mood score from 1 to 10." }
        },
        required: ["score", "label", "summary", "analysis", "moodScore"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Failed to parse AI response:", response.text);
    // Fallback values if parsing fails
    return {
      score: 0,
      label: "Neutral",
      summary: "Entry analyzed.",
      analysis: "Unable to parse deep analysis.",
      moodScore: 5
    };
  }
}

export async function queryJournalHistory(query: string, entries: any[]): Promise<string> {
  const context = entries.map(e => `Date: ${new Date(e.createdAt.seconds * 1000).toLocaleDateString()}\nContent: ${e.content}\nSummary: ${e.summary}`).join('\n\n');
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a personal journal assistant. Based on the following journal entries, answer the user's question. Be empathetic and insightful.
    
    User Question: "${query}"
    
    Journal Context:
    ${context}`,
  });

  return response.text;
}
