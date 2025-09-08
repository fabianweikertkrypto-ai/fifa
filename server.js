const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DB_FILE = 'fifa.json';
const TOURNAMENT_FILE = 'tournament.json';

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
        return { users: [], tournamentStatus: 'registration' };
    }
}

// Hilfsfunktion: Datenbank schreiben
async function writeDatabase(data) {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Hilfsfunktion: Turnier-Daten lesen
async function readTournament() {
    try {
        const data = await fs.readFile(TOURNAMENT_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

// Hilfsfunktion: Turnier-Daten schreiben
async function writeTournament(data) {
    await fs.writeFile(TOURNAMENT_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Hilfsfunktion: Array mischen (Fisher-Yates Shuffle)
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Hilfsfunktion: Single Elimination Bracket erstellen
function createSingleEliminationBracket(players) {
    const shuffledPlayers = shuffleArray(players);
    
    // Berechne nächste Potenz von 2
    let bracketSize = 1;
    while (bracketSize < shuffledPlayers.length) {
        bracketSize *= 2;
    }
    
    // Erstelle erste Runde
    const firstRound = [];
    const playersWithByes = [];
    
    // Anzahl der Freilose
    const byes = bracketSize - shuffledPlayers.length;
    
    // Verteile Freilose zufällig
    const playersCopy = [...shuffledPlayers];
    for (let i = 0; i < byes; i++) {
        const randomIndex = Math.floor(Math.random() * playersCopy.length);
        const playerWithBye = playersCopy.splice(randomIndex, 1)[0];
        playersWithByes.push(playerWithBye);
    }
    
    // Erstelle Matches für verbleibende Spieler
    for (let i = 0; i < playersCopy.length; i += 2) {
        if (i + 1 < playersCopy.length) {
            firstRound.push({
                id: `match_${Date.now()}_${i/2}`,
                player1: playersCopy[i],
                player2: playersCopy[i + 1],
                winner: null,
                score1: null,
                score2: null,
                status: 'pending',
                pendingResults: []
            });
        }
    }
    
    // Berechne Anzahl der Runden
    const totalRounds = Math.log2(bracketSize);
    
    return {
        bracketSize,
        totalRounds,
        currentRound: 1,
        rounds: [firstRound],
        playersWithByes,
        isComplete: false,
        winner: null
    };
}

// Route: Benutzer registrieren (nur wenn Turnier noch nicht gestartet)
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

        // Prüfen ob Registrierung noch offen ist
        if (db.tournamentStatus === 'started' || db.tournamentStatus === 'finished') {
            return res.status(400).json({ error: 'Die Registrierung für das Turnier ist geschlossen' });
        }

        // Prüfen ob Wallet bereits registriert ist
        const existingUser = db.users.find(user => user.walletAddress.toLowerCase() === walletAddress.toLowerCase());
        if (existingUser) {
            return res.status(400).json({ error: 'Diese Wallet-Adresse ist bereits registriert' });
        }

        // Neuen Benutzer erstellen
        const newUser = {
            id: Date.now().toString(),
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

// Route: Turnier starten
app.post('/tournament/start', async (req, res) => {
    try {
        const db = await readDatabase();
        
        // Prüfen ob genügend Spieler registriert sind
        if (db.users.length < 2) {
            return res.status(400).json({ error: 'Mindestens 2 Spieler müssen registriert sein' });
        }
        
        // Prüfen ob Turnier bereits gestartet wurde
        if (db.tournamentStatus === 'started') {
            return res.status(400).json({ error: 'Turnier wurde bereits gestartet' });
        }
        
        // Turnier-Status ändern
        db.tournamentStatus = 'started';
        db.tournamentStartTime = new Date().toISOString();
        await writeDatabase(db);
        
        // Turnier-Bracket erstellen
        const bracket = createSingleEliminationBracket(db.users);
        
        const tournamentData = {
            id: Date.now().toString(),
            startTime: new Date().toISOString(),
            status: 'started',
            totalPlayers: db.users.length,
            bracket: bracket
        };
        
        await writeTournament(tournamentData);
        
        console.log(`Turnier gestartet mit ${db.users.length} Spielern`);
        
        res.json({
            message: 'Turnier erfolgreich gestartet',
            tournament: tournamentData
        });
        
    } catch (error) {
        console.error('Fehler beim Starten des Turniers:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Route: Turnier-Status und Bracket abrufen
app.get('/tournament', async (req, res) => {
    try {
        const db = await readDatabase();
        const tournament = await readTournament();
        
        res.json({
            status: db.tournamentStatus || 'registration',
            startTime: db.tournamentStartTime || null,
            totalPlayers: db.users.length,
            tournament: tournament
        });
        
    } catch (error) {
        console.error('Fehler beim Laden des Turniers:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Route: Match-Ergebnis von Spieler einreichen
app.post('/tournament/match/:matchId/submit-result', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { submittedBy, walletAddress, score1, score2 } = req.body;
        
        // Validierung
        if (!submittedBy || !walletAddress || score1 === undefined || score2 === undefined) {
            return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
        }
        
        if (score1 === score2) {
            return res.status(400).json({ error: 'Unentschieden sind nicht erlaubt' });
        }
        
        const tournament = await readTournament();
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }
        
        // Match finden
        let targetMatch = null;
        let roundIndex = -1;
        
        for (let i = 0; i < tournament.bracket.rounds.length; i++) {
            const match = tournament.bracket.rounds[i].find(m => m.id === matchId);
            if (match) {
                targetMatch = match;
                roundIndex = i;
                break;
            }
        }
        
        if (!targetMatch) {
            return res.status(404).json({ error: 'Match nicht gefunden' });
        }
        
        if (targetMatch.status === 'completed') {
            return res.status(400).json({ error: 'Match wurde bereits abgeschlossen' });
        }
        
        // Prüfen ob Spieler Teil des Matches ist
        if (submittedBy !== targetMatch.player1.id && submittedBy !== targetMatch.player2.id) {
            return res.status(403).json({ error: 'Sie sind nicht Teil dieses Matches' });
        }
        
        // Initialisiere pendingResults falls nicht vorhanden
        if (!targetMatch.pendingResults) {
            targetMatch.pendingResults = [];
        }
        
        // Prüfen ob Spieler bereits ein Ergebnis eingereicht hat
        const existingResult = targetMatch.pendingResults.find(r => r.submittedBy === submittedBy);
        if (existingResult) {
            return res.status(400).json({ error: 'Sie haben bereits ein Ergebnis eingereicht' });
        }
        
        // Ergebnis hinzufügen
        targetMatch.pendingResults.push({
            submittedBy,
            walletAddress,
            score1: parseInt(score1),
            score2: parseInt(score2),
            submittedAt: new Date().toISOString()
        });
        
        // Prüfen ob beide Spieler eingereicht haben
        if (targetMatch.pendingResults.length === 2) {
            const result1 = targetMatch.pendingResults[0];
            const result2 = targetMatch.pendingResults[1];
            
            // Prüfen ob Ergebnisse übereinstimmen
            if (result1.score1 === result2.score1 && result1.score2 === result2.score2) {
                // Ergebnisse stimmen überein - Match automatisch abschließen
                targetMatch.score1 = result1.score1;
                targetMatch.score2 = result1.score2;
                targetMatch.winner = result1.score1 > result1.score2 ? targetMatch.player1 : targetMatch.player2;
                targetMatch.status = 'completed';
                targetMatch.completedAt = new Date().toISOString();
                targetMatch.completedBy = 'auto';
                
                console.log(`Match ${matchId} automatisch abgeschlossen: ${targetMatch.score1}:${targetMatch.score2}`);
                
                // Prüfen ob Runde abgeschlossen ist und nächste Runde erstellen
                await checkAndAdvanceRound(tournament, roundIndex);
                
                await writeTournament(tournament);
                
                return res.json({
                    message: 'Ergebnis eingereicht und Match automatisch abgeschlossen',
                    tournament: tournament
                });
            } else {
                // Konflikt markieren
                targetMatch.pendingResults.forEach(r => r.conflict = true);
                
                await writeTournament(tournament);
                
                console.log(`Match ${matchId} hat widersprüchliche Ergebnisse`);
                
                return res.json({
                    message: 'Ergebnis eingereicht - Konflikt erkannt, Admin-Entscheidung erforderlich',
                    conflict: true
                });
            }
        } else {
            // Warte auf zweites Ergebnis
            await writeTournament(tournament);
            
            return res.json({
                message: 'Ergebnis eingereicht - warte auf Gegner',
                waitingForOpponent: true
            });
        }
        
    } catch (error) {
        console.error('Fehler beim Einreichen des Ergebnisses:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Route: Match-Ergebnis durch Admin eintragen (überschreibt Konflikte)
app.post('/tournament/match/:matchId/result', async (req, res) => {
    try {
        const { matchId } = req.params;
        const { winnerId, score1, score2 } = req.body;
        
        // Wenn score1 und score2 vorhanden sind, nutze diese
        // Ansonsten nur winnerId für Rückwärtskompatibilität
        
        const tournament = await readTournament();
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }
        
        // Match finden
        let targetMatch = null;
        let roundIndex = -1;
        
        for (let i = 0; i < tournament.bracket.rounds.length; i++) {
            const match = tournament.bracket.rounds[i].find(m => m.id === matchId);
            if (match) {
                targetMatch = match;
                roundIndex = i;
                break;
            }
        }
        
        if (!targetMatch) {
            return res.status(404).json({ error: 'Match nicht gefunden' });
        }
        
        // Score setzen falls vorhanden
        if (score1 !== undefined && score2 !== undefined) {
            targetMatch.score1 = parseInt(score1);
            targetMatch.score2 = parseInt(score2);
            targetMatch.winner = targetMatch.score1 > targetMatch.score2 ? targetMatch.player1 : targetMatch.player2;
        } else if (winnerId) {
            // Alte Logik für Rückwärtskompatibilität
            if (winnerId !== targetMatch.player1.id && winnerId !== targetMatch.player2.id) {
                return res.status(400).json({ error: 'Ungültige Gewinner-ID' });
            }
            targetMatch.winner = winnerId === targetMatch.player1.id ? targetMatch.player1 : targetMatch.player2;
        } else {
            return res.status(400).json({ error: 'Gewinner oder Spielstand erforderlich' });
        }
        
        targetMatch.status = 'completed';
        targetMatch.completedAt = new Date().toISOString();
        targetMatch.completedBy = 'admin';
        targetMatch.pendingResults = []; // Lösche ausstehende Ergebnisse
        
        // Prüfen ob Runde abgeschlossen ist und nächste Runde erstellen
        await checkAndAdvanceRound(tournament, roundIndex);
        
        await writeTournament(tournament);
        
        res.json({
            message: 'Match-Ergebnis erfolgreich eingetragen',
            tournament: tournament
        });
        
    } catch (error) {
        console.error('Fehler beim Eintragen des Match-Ergebnisses:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Hilfsfunktion: Prüfen und nächste Runde erstellen
async function checkAndAdvanceRound(tournament, currentRoundIndex) {
    const currentRound = tournament.bracket.rounds[currentRoundIndex];
    const allMatchesCompleted = currentRound.every(m => m.status === 'completed');
    
    if (allMatchesCompleted) {
        // Nächste Runde erstellen oder Turnier beenden
        const winners = currentRound.map(m => m.winner);
        const advancingPlayers = [...winners];
        
        // Füge Spieler mit Freilosen hinzu (nur in erster Runde)
        if (currentRoundIndex === 0 && tournament.bracket.playersWithByes) {
            advancingPlayers.push(...tournament.bracket.playersWithByes);
            tournament.bracket.playersWithByes = [];
        }
        
        if (advancingPlayers.length === 1) {
            // Turnier beendet
            tournament.bracket.isComplete = true;
            tournament.bracket.winner = advancingPlayers[0];
            tournament.status = 'finished';
            
            // Auch in Hauptdatenbank aktualisieren
            const db = await readDatabase();
            db.tournamentStatus = 'finished';
            db.tournamentWinner = advancingPlayers[0];
            await writeDatabase(db);
            
            console.log(`Turnier beendet! Gewinner: ${advancingPlayers[0].username}`);
        } else if (currentRoundIndex + 1 === tournament.bracket.currentRound) {
            // Nur wenn wir in der aktuellen Runde sind, nächste Runde erstellen
            tournament.bracket.currentRound++;
            const nextRound = [];
            
            for (let i = 0; i < advancingPlayers.length; i += 2) {
                if (i + 1 < advancingPlayers.length) {
                    nextRound.push({
                        id: `match_${Date.now()}_${i/2}_round${tournament.bracket.currentRound}`,
                        player1: advancingPlayers[i],
                        player2: advancingPlayers[i + 1],
                        winner: null,
                        score1: null,
                        score2: null,
                        status: 'pending',
                        pendingResults: []
                    });
                }
            }
            
            tournament.bracket.rounds.push(nextRound);
            console.log(`Runde ${tournament.bracket.currentRound} erstellt mit ${nextRound.length} Matches`);
        }
    }
}

// Route: Konflikte abrufen (für Admin)
app.get('/tournament/conflicts', async (req, res) => {
    try {
        const tournament = await readTournament();
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }
        
        const conflicts = [];
        
        tournament.bracket.rounds.forEach((round, roundIndex) => {
            round.forEach(match => {
                if (match.pendingResults && match.pendingResults.length === 2 && 
                    match.pendingResults.some(r => r.conflict)) {
                    conflicts.push({
                        matchId: match.id,
                        round: roundIndex + 1,
                        player1: match.player1,
                        player2: match.player2,
                        results: match.pendingResults
                    });
                }
            });
        });
        
        res.json({ conflicts });
        
    } catch (error) {
        console.error('Fehler beim Abrufen der Konflikte:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Bestehende Routes...

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

// Route: Alle registrierten Benutzer anzeigen
app.get('/users', async (req, res) => {
    try {
        const db = await readDatabase();
        res.json({
            totalUsers: db.users.length,
            users: db.users,
            tournamentStatus: db.tournamentStatus || 'registration'
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
            registrationsByDate,
            tournamentStatus: db.tournamentStatus || 'registration'
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
    console.log(`Server läuft auf http://localhost:${PORT}`);
    console.log(`Admin-Bereich: http://localhost:${PORT}/admin.html`);
    console.log(`Öffentlicher Turnierbaum: http://localhost:${PORT}/tournament.html`);
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
