CREATE TABLE IF NOT EXISTS clients (
                                       id SERIAL PRIMARY KEY,
                                       nom TEXT NOT NULL,
                                       ville TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commandes (
                                         id SERIAL PRIMARY KEY,
                                         client_id INT REFERENCES clients(id),
    montant NUMERIC(10,2) NOT NULL,
    date_commande DATE NOT NULL
    );

INSERT INTO clients (nom, ville) VALUES
                                     ('Alice Durand', 'Paris'), ('Karim Haddad', 'Lyon'), ('Sophie Martin', 'Paris'),
                                     ('Youssef Trabelsi', 'Marseille'), ('Léa Bernard', 'Lyon'), ('Marc Petit', 'Lille');

INSERT INTO commandes (client_id, montant, date_commande)
SELECT (1 + floor(random() * 6))::int,
    round((20 + random() * 480)::numeric, 2),
       (current_date - (random() * 75)::int)
FROM generate_series(1, 60);

-- Rôle en lecture seule : la vraie protection
CREATE ROLE lecteur LOGIN PASSWORD 'lecteur';
GRANT CONNECT ON DATABASE postgres TO lecteur;
GRANT USAGE ON SCHEMA public TO lecteur;
GRANT SELECT ON clients, commandes TO lecteur;