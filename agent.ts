import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import pg from "pg";
import { appelerLLM } from "./llm.js";

const MAX_ITERATIONS = 8;
const MAX_LIGNES = 50;
const DOSSIER_AUTORISE = path.resolve("data");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_LECTEUR });

// ---------- Outils ----------
async function lireFichier(nom: string): Promise<string> {
    const chemin = path.resolve(DOSSIER_AUTORISE, nom);
    if (!chemin.startsWith(DOSSIER_AUTORISE + path.sep)) return "Erreur : accès refusé.";
    try {
        return await readFile(chemin, "utf-8");
    } catch {
        return `Erreur : fichier introuvable (${nom}).`;
    }
}

async function executerSql(requete: string): Promise<string> {
    if (!/^\s*(select|with)\b/i.test(requete)) {
        return "Erreur : seules les requêtes SELECT sont autorisées.";
    }
    const connexion = await pool.connect();
    try {
        await connexion.query("BEGIN READ ONLY");
        await connexion.query("SET LOCAL statement_timeout = 5000");
        const res = await connexion.query(requete);
        const lignes = res.rows.slice(0, MAX_LIGNES);
        const suite = res.rows.length > MAX_LIGNES ? ` (tronqué : ${res.rows.length} lignes au total)` : "";
        return JSON.stringify(lignes) + suite;
    } catch (e: any) {
        // l'erreur est renvoyée au modèle : il peut se corriger tout seul
        return `Erreur SQL : ${e.message}`;
    } finally {
        await connexion.query("ROLLBACK").catch(() => {});
        connexion.release();
    }
}

const outils: OpenAI.Chat.ChatCompletionTool[] = [
    {
        type: "function",
        function: {
            name: "lire_fichier",
            description: "Lit un fichier texte du dossier data.",
            parameters: {
                type: "object",
                properties: { nom: { type: "string", description: "Ex : notes.txt" } },
                required: ["nom"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "executer_sql",
            description: "Exécute une requête SQL SELECT (lecture seule) sur la base PostgreSQL.",
            parameters: {
                type: "object",
                properties: { requete: { type: "string", description: "Une requête SELECT" } },
                required: ["requete"],
            },
        },
    },
];

async function executerOutil(nom: string, args: any): Promise<string> {
    if (nom === "lire_fichier") return lireFichier(args.nom);
    if (nom === "executer_sql") return executerSql(args.requete);
    return `Erreur : outil inconnu (${nom}).`;
}

// ---------- La boucle ----------
const SYSTEME = `Tu es un assistant de données. Réponds en français.
Schéma de la base PostgreSQL :
- clients(id, nom, ville)
- commandes(id, client_id, montant, date_commande)
Utilise executer_sql pour toute question chiffrée. N'invente jamais un chiffre.
Aujourd'hui : ${new Date().toISOString().slice(0, 10)}.`;

async function agent(question: string) {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEME },
        { role: "user", content: question },
    ];
    let totalTokens = 0;

    for (let i = 1; i <= MAX_ITERATIONS; i++) {
        const r = await appelerLLM({ messages, tools: outils });
        totalTokens += r.usage?.total_tokens ?? 0;
        const msg = r.choices[0].message;
        console.log(`\n--- Tour ${i} | tokens cumulés : ${totalTokens} ---`);

        if (!msg.tool_calls?.length) {
            console.log("\nRéponse finale :", msg.content);
            return;
        }

        messages.push(msg); // renvoyer l'objet original, jamais une copie reconstruite
        for (const appel of msg.tool_calls) {
            if (appel.type !== "function") continue;
            const args = JSON.parse(appel.function.arguments);
            console.log(`Outil : ${appel.function.name}`, args);
            const resultat = await executerOutil(appel.function.name, args);
            console.log("Résultat :", resultat.slice(0, 300));
            messages.push({ role: "tool", tool_call_id: appel.id, content: resultat });
        }
    }
    console.log(`\nArrêt : limite de ${MAX_ITERATIONS} itérations atteinte.`);
}

await agent(process.argv[2] ?? "Combien de clients ont passé commande le mois dernier ?");
await pool.end();