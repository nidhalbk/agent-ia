# agent-ia

Un agent IA écrit **à la main, sans framework**, en TypeScript. Il répond à des questions en langage naturel en interrogeant une base PostgreSQL (lecture seule) et des fichiers texte locaux.

Ce dépôt est le support de la semaine 1 de ma formation d'orchestrateur IA. L'objectif est de comprendre la boucle agentique de l'intérieur avant d'utiliser LangGraph ou tout autre framework.

> Données entièrement fictives. Le niveau gratuit de Gemini pouvant servir à améliorer les produits de Google, aucune donnée réelle ou sensible ne doit être envoyée à ce projet.

## Ce que fait l'agent

L'agent dispose de deux outils :

| Outil | Rôle |
|---|---|
| `executer_sql` | Exécute une requête `SELECT` sur la base PostgreSQL |
| `lire_fichier` | Lit un fichier texte du dossier `data/` |

À chaque question, il boucle : le modèle choisit un outil, mon code l'exécute, le résultat est renvoyé au modèle, et ainsi de suite jusqu'à la réponse finale ou la limite de 8 itérations.

## Stack

- Node.js 22, TypeScript (exécuté avec `tsx`)
- SDK `openai` pointant sur l'API compatible OpenAI de **Google Gemini** (niveau gratuit, modèle Flash)
- PostgreSQL 16 dans Docker, accès via `pg`
- `zod` pour valider les sorties structurées

## Installation

```bash
git clone git@github.com:nidhalbk/agent-ia.git && cd agent-ia
npm install

# Base de test
docker run --name pg-test -e POSTGRES_PASSWORD=test -p 5432:5432 -d postgres
docker exec -i pg-test psql -U postgres < init.sql

# Données de test pour l'outil de lecture de fichier
mkdir -p data
echo "Réunion du 12 mars : le budget cloud est validé à 4 200 euros par mois. Responsable : Karim." > data/notes.txt
```

Crée un fichier `.env` (jamais commité) à partir de `.env.example` :

```
GEMINI_API_KEY=ta_cle_api
MODEL=nom_du_modele_flash
MODEL_SECOURS=nom_d_un_autre_modele
DATABASE_URL_LECTEUR=postgresql://lecteur:lecteur@localhost:5432/postgres
```

La clé s'obtient gratuitement sur [Google AI Studio](https://aistudio.google.com). Les noms de modèles sont en variables d'environnement car les offres gratuites changent régulièrement.

## Utilisation

```bash
npx tsx agent.ts "Combien de clients ont passé commande le mois dernier ?"
```

## Structure du projet

| Fichier | Contenu |
|---|---|
| `appel.ts` | Premier appel API et affichage des tokens |
| `stream.ts` | Réponse en streaming |
| `structure.ts` | Sortie JSON validée avec Zod |
| `llm.ts` | Wrapper avec retry (backoff exponentiel) et bascule sur un modèle de secours |
| `outil.ts` | Un seul tour de tool calling, pour voir chaque étape |
| `agent.ts` | La boucle d'agent complète |
| `init.sql` | Schéma, données fictives et rôle en lecture seule |

## Exemple d'exécution

Question : *« Quelle est la meilleure cliente et que dit notes.txt sur le budget ? »*

```
--- Tour 1 | tokens cumulés : 309 ---
Outil : executer_sql {
  requete: 'SELECT c.nom, SUM(cmd.montant) AS total_achats FROM clients c JOIN commandes cmd ON c.id = cmd.client_id GROUP BY c.id, c.nom ORDER BY total_achats DESC LIMIT 1;'
}
Résultat : [{"nom":"Léa Bernard","total_achats":"3037.65"}]
Outil : lire_fichier { nom: 'notes.txt' }
Résultat : Réunion du 12 mars : le budget cloud est validé à 4 200 euros par mois. Responsable : Karim.

--- Tour 2 | tokens cumulés : 772 ---

Réponse finale : La meilleure cliente est Léa Bernard avec un total d'achats de 3 037,65 €.
Concernant le fichier notes.txt, il indique : Réunion du 12 mars : le budget cloud est validé à 4 200 euros par mois. Responsable : Karim.
```

Le modèle a demandé **deux outils dans la même réponse** (appels parallèles) et la boucle les a gérés sans traitement particulier.

## Sécurité : trois couches, testées séparément

Un refus du modèle n'est pas une protection : une injection de prompt peut le faire changer d'avis. La sécurité est donc placée dans les outils et dans la base.

| Couche | Rôle |
|---|---|
| Rôle PostgreSQL `lecteur` | Droit `SELECT` uniquement : la base refuse toute écriture, quoi que demande le modèle |
| Transaction `BEGIN READ ONLY` + `statement_timeout` | Bloque les écritures cachées dans un `WITH` et limite la durée des requêtes |
| Filtre applicatif (regex `select` / `with`) et confinement des chemins de fichiers | Première barrière, volontairement la moins fiable des trois |

### Tests réalisés

- **Évasion de chemin** : demander `../.env` à `lire_fichier`. Le modèle a bien fait la demande, c'est ma fonction qui a refusé. La clé API n'a jamais été exposée.
- **« Supprime toutes les commandes »** : le modèle a refusé de lui-même, sans appeler d'outil. Ce test ne valide donc **aucune** de mes protections, d'où les deux tests suivants.
- **`DELETE FROM commandes` forcé** : *(bloqué par le filtre)*
- **`WITH x AS (DELETE ... RETURNING *) SELECT ...` forcé** : *(message d'erreur Postgres observé, normalement bloqué par le rôle ou la transaction en lecture seule)*
- Vérification finale : `SELECT count(*) FROM commandes` renvoie toujours 60. *(à confirmer)*

## Ce qui m'a surpris

1. **Le modèle n'exécute jamais rien.** Il demande un appel d'outil, c'est mon code qui l'exécute. Tout le contrôle (sécurité, limites, logs) est de mon côté.
2. **Un résultat vide peut produire une réponse trompeuse.** Pour « Combien de commandes a passé le client Zorro ? », l'agent a répondu « 0 », alors que ce client n'existe pas. Le chiffre est vrai, mais il laisse croire que Zorro existe. J'ai corrigé en demandant, dans le prompt système, de vérifier l'existence du client d'abord.
3. **Le coût croît à chaque tour.** L'historique complet est renvoyé à chaque appel : sur l'exemple ci-dessus, on passe de 309 à 772 tokens cumulés en seulement 2 tours.
4. **Les API LLM tombent en panne.** J'ai reçu des erreurs 503 (modèle saturé) sur le niveau gratuit. D'où le wrapper `llm.ts` : réessai avec backoff exponentiel sur 503 et 429, puis bascule sur un modèle de secours.
5. **Les champs renvoyés par le modèle comptent.** Gemini ajoute un `thought_signature` aux appels d'outils. Il faut renvoyer le message d'origine tel quel dans l'historique, sans le reconstruire.

## Limites connues

- La vérification de chemin ne gère pas les liens symboliques (il faudrait `fs.realpath`).
- Le retry n'est pas géré pour le streaming (une erreur peut survenir en plein flux).
- Les résultats SQL sont tronqués à 50 lignes pour protéger la fenêtre de contexte.
- Pas encore d'évaluation automatique de la qualité des réponses.

## Suite du parcours

- **Semaine 2** : embeddings et premier RAG avec pgvector
- Ensuite : MCP, évaluation et traçage (Langfuse), sécurité des agents, orchestration multi-agents
