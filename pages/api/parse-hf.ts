import type { NextApiRequest, NextApiResponse } from "next";
import { InferenceClient } from "@huggingface/inference";


const client = new InferenceClient({ 
  apiKey: process.env.HUGGINGFACE_API_KEY 
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { pdfText } = req.body;
  if (!pdfText) return res.status(400).json({ error: "Missing PDF text" });

  // Wrap prompt with [INST] ... [/INST] as required by the model
  const prompt = `[INST] You are an expert at extracting credit card statement data. Extract the following fields in strict JSON format from the given text:

{
  "issuer": "",
  "cardLast4": "",
  "statementPeriod": "",
  "dueDate": "",
  "totalBalance": "",
  "minimumPayment": ""
}

If a field is missing, use "Not Found".

Here is the statement text:
<<<
${pdfText}
>>>
[/INST]`;

  try {

    const response = await client.textGeneration({
      model: "google/flan-t5-large",
      inputs: prompt,
      parameters: {
        max_new_tokens: 512,
        temperature: 0.2,
      },
    });

    const text = response.generated_text ?? response[0]?.generated_text ?? "";


    // Try parse JSON from text
    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      if (text.trim() === "Not Found" || !text.trim()) {
        parsed = {
          issuer: "Not Found",
          cardLast4: "Not Found",
          statementPeriod: "Not Found",
          dueDate: "Not Found",
          totalBalance: "Not Found",
          minimumPayment: "Not Found",
        };
      } else {
        const jsonMatch = text.match(/\{[\s\S]+\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      }
    }

    if (!parsed) {
      return res.status(500).json({ error: "Failed to parse model output" });
    }

    return res.status(200).json(parsed);
  } catch (err: any) {
    console.error("HuggingFace error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
}
