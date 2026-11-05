import "dotenv/config";
import OpenAI from "openai";

export const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    maxRetries: 0, // on gère nous-mêmes pour voir ce qui se passe
});

// Modèles à essayer dans l'ordre (mets les noms exacts d'AI Studio)
const MODELES = [process.env.MODEL_SECOURS, process.env.MODEL!].filter(Boolean) as string[];

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function appelerLLM(
    params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, "model">,
    essaisParModele = 3
) {
    for (const model of MODELES) {
        for (let essai = 1; essai <= essaisParModele; essai++) {
            try {
                return await client.chat.completions.create({ ...params, model });
            } catch (e: any) {
                const temporaire = e?.status === 503 || e?.status === 429;
                if (!temporaire) throw e; // erreur de code ou de clé : inutile de réessayer
                const delai = 2 ** essai * 1000 + Math.random() * 500; // 2s, 4s, 8s + jitter
                console.warn(`[${model}] erreur ${e.status}, essai ${essai}/${essaisParModele}, attente ${Math.round(delai)} ms`);
                await attendre(delai);
            }
        }
        console.warn(`[${model}] abandonné, passage au modèle suivant`);
    }
    throw new Error("Tous les modèles ont échoué");
}