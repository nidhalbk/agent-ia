import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const r = await client.chat.completions.create({
    model: process.env.MODEL!,
    messages: [{ role: "user", content: "Explique ce qu'est un token en 2 phrases." }],
});

console.log(r.choices[0].message.content);
console.log("Tokens :", r.usage);