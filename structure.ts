import "dotenv/config";
import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// 1. Le contrat : ce que tu attends exactement
const Candidat = z.object({
    nom: z.string(),
    annees_experience: z.number(),
    competences: z.array(z.string()),
    niveau: z.enum(["junior", "confirme", "senior"]),
});

const texte = `Sophie Martin, développeuse depuis 9 ans, maîtrise Node.js,
PostgreSQL et Docker. Elle a encadré deux équipes.`;

// 2. L'appel
const r = await client.chat.completions.create({
    model: process.env.MODEL_SECOURS!,
    response_format: { type: "json_object" },
    messages: [
        {
            role: "system",
            content:
                'Tu extrais des informations. Réponds uniquement avec un objet JSON ayant les clés : nom (string), annees_experience (number), competences (string[]), niveau ("junior" | "confirme" | "senior").',
        },
        { role: "user", content: texte },
    ],
});

// 3. La validation : ne jamais faire confiance au modèle
const brut = r.choices[0].message.content ?? "";
const resultat = Candidat.safeParse(JSON.parse(brut));

if (resultat.success) {
    console.log("Valide :", resultat.data);
} else {
    console.error("JSON invalide :", resultat.error.issues);
}

console.log("Tokens :", r.usage);