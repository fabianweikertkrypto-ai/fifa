const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DB_FILE = 'fifa.json'; // JSON ist einfacher zu handhaben als .bd

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS)
app.use(express.static('.'));

// Hilfsfunktion: Datenbank lesen
async function readDatabase() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Datei existiert noch nicht, leere Datenbank zurückgeben
        return { users: [] };
    }
}

// Hilfsfunktion: Datenbank schreiben
async function writeDatabase(data) {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Route: Benutzer registrieren
app.post('/register', async (req, res) => {
    try {
        const { username, walletAddress } = req.body;

        // Eingaben validieren
        if (!username || !walletAddress) {
            return res.status(400).json({ error: 'Username und Wallet-Adresse sind erforderlich' });
        }

        if (username.length > 50) {
            return res.status(400).json({ error: 'Username darf maximal 50 Zeichen lang sein' });
        }

        // Datenbank lesen
        const db = await readDatabase();

        // Prüfen ob Wallet bereits registriert ist
        const existingUser = db.users.find(user => user.walletAddress.toLowerCase() === walletAddress.toLowerCase());
        if (existingUser) {
            return res.status(400).json({ error: 'Diese Wallet-Adresse ist bereits registriert' });
        }

        // Neuen Benutzer erstellen
        const newUser = {
            id: Date.now().toString(), // Einfache ID basierend auf Timestamp
            username: username.trim(),
            walletAddress: walletAddress,
            registrationTime: new Date().toISOString()
        };

        // Benutzer zur Datenbank hinzufügen
        db.users.push(newUser);

        // Datenbank speichern
        await writeDatabase(db);

        console.log(`Neuer Benutzer registriert: ${username} (${walletAddress})`);
        
        res.status(201).json({
            message: 'Benutzer erfolgreich registriert',
            user: newUser
        });

    } catch (error) {
        console.error('Fehler beim Registrieren:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Route: Benutzer nach Wallet-Adresse suchen
app.get('/user/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;

        const db = await readDatabase();
        const user = db.users.find(user => user.walletAddress.toLowerCase() === walletAddress.toLowerCase());

        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }

    } catch (error) {
        console.error('Fehler beim Suchen des Benutzers:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Route: Alle registrierten Benutzer anzeigen (optional für Admin)
app.get('/users', async (req, res) => {
    try {
        const db = await readDatabase();
        res.json({
            totalUsers: db.users.length,
            users: db.users
        });
    } catch (error) {
        console.error('Fehler beim Laden der Benutzer:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Route: Statistiken
app.get('/stats', async (req, res) => {
    try {
        const db = await readDatabase();
        
        // Registrierungen nach Datum gruppieren
        const registrationsByDate = {};
        db.users.forEach(user => {
            const date = new Date(user.registrationTime).toDateString();
            registrationsByDate[date] = (registrationsByDate[date] || 0) + 1;
        });

        res.json({
            totalRegistrations: db.users.length,
            latestRegistrations: db.users
                .sort((a, b) => new Date(b.registrationTime) - new Date(a.registrationTime))
                .slice(0, 10),
            registrationsByDate
        });
    } catch (error) {
        console.error('Fehler beim Laden der Statistiken:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Route: Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Server starten
app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
    console.log(`📊 Admin-Bereich: http://localhost:${PORT}/users`);
    console.log(`📈 Statistiken: http://localhost:${PORT}/stats`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Server wird beendet...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Server wird beendet...');
    process.exit(0);
});