import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const stream = await client.chat.completions.create({
    model: process.env.MODEL_SECOURS!,
    messages: [
        { role: "user", content: "Explique la fenêtre de contexte à un développeur web, en 5 phrases." },
    ],
    stream: true,
    stream_options: { include_usage: true },
});

for await (const chunk of stream) {
    const texte = chunk.choices[0]?.delta?.content;
    if (texte) process.stdout.write(texte);
    if (chunk.usage) console.log("\n\nTokens :", chunk.usage);
}