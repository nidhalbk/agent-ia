import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { appelerLLM } from "./llm.js";

const DOSSIER_AUTORISE = path.resolve("data");

// 1. L'outil : une fonction ordinaire, avec une protection
async function lireFichier(nom: string): Promise<string> {
    const chemin = path.resolve(DOSSIER_AUTORISE, nom);
    if (!chemin.startsWith(DOSSIER_AUTORISE + path.sep)) {
        return "Erreur : accès refusé en dehors du dossier data.";
    }
    try {
        return await readFile(chemin, "utf-8");
    } catch {
        return `Erreur : fichier introuvable (${nom}).`;
    }
}

// 2. La description de l'outil, c'est ce que voit le modèle
const outils: OpenAI.Chat.ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "lire_fichier",
            description: "Lit le contenu d'un fichier texte du dossier data.",
            parameters: {
                type: "object",
                properties: {
                    nom: { type: "string", description: "Nom du fichier, par exemple notes.txt" },
                },
                required: ["nom"],
            },
        },
    },
];

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: "Lis le fichier budget.txt" },
];

// 3. Premier appel : le modèle décide s'il veut un outil
const r1 = await appelerLLM({ messages, tools: outils });
const reponse1 = r1.choices[0].message;
console.log("Demande du modèle :", JSON.stringify(reponse1.tool_calls, null, 2));

if (!reponse1.tool_calls?.length) {
    console.log("Réponse directe :", reponse1.content);
    process.exit(0);
}

// 4. On exécute chaque appel demandé
messages.push(reponse1); // le modèle doit retrouver sa propre demande dans l'historique
for (const appel of reponse1.tool_calls) {
    if (appel.type !== "function") continue;
    const args = JSON.parse(appel.function.arguments);
    console.log(`Exécution : ${appel.function.name}`, args);
    const resultat = await lireFichier(args.nom);
    messages.push({ role: "tool", tool_call_id: appel.id, content: resultat });
}

// 5. Second appel : le modèle rédige la réponse finale
const r2 = await appelerLLM({ messages, tools: outils });
console.log("\nRéponse finale :", r2.choices[0].message.content);
console.log("Tokens (2e appel) :", r2.usage);
console.log(JSON.stringify(r2.choices[0].message, null, 2));