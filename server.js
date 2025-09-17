const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Database files
const GLOBAL_USERS_FILE = 'globalUsers.json';
const GAMES_FILE = 'games.json';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ========== HELPER FUNCTIONS ==========

// Global Users Database
async function readGlobalUsers() {
    try {
        const data = await fs.readFile(GLOBAL_USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { users: {} };
    }
}

async function writeGlobalUsers(data) {
    await fs.writeFile(GLOBAL_USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Games Database
async function readGames() {
    try {
        const data = await fs.readFile(GAMES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { 
            games: {
                fifa: {
                    id: 'fifa',
                    name: 'FIFA',
                    tournaments: {},
                    activeTournamentId: null
                },
                cod: {
                    id: 'cod',
                    name: 'Call of Duty',
                    tournaments: {},
                    activeTournamentId: null
                }
            }
        };
    }
}

async function writeGames(data) {
    await fs.writeFile(GAMES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Array shuffle (Fisher-Yates)
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Single Elimination Bracket
function createSingleEliminationBracket(players) {
    const shuffledPlayers = shuffleArray(players);
    
    let bracketSize = 1;
    while (bracketSize < shuffledPlayers.length) {
        bracketSize *= 2;
    }
    
    const firstRound = [];
    const playersWithByes = [];
    
    const byes = bracketSize - shuffledPlayers.length;
    
    const playersCopy = [...shuffledPlayers];
    for (let i = 0; i < byes; i++) {
        const randomIndex = Math.floor(Math.random() * playersCopy.length);
        const playerWithBye = playersCopy.splice(randomIndex, 1)[0];
        playersWithByes.push(playerWithBye);
    }
    
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

// ========== GLOBAL USER ROUTES ==========

// Register or update global user
app.post('/user/register', async (req, res) => {
    try {
        const { walletAddress, platformUsername, gamertags } = req.body;

        if (!walletAddress || !platformUsername) {
            return res.status(400).json({ error: 'Wallet-Adresse und Plattform-Username sind erforderlich' });
        }

        if (platformUsername.length > 50) {
            return res.status(400).json({ error: 'Username darf maximal 50 Zeichen lang sein' });
        }

        const globalUsers = await readGlobalUsers();
        const userKey = walletAddress.toLowerCase();
        
        // Check if username is taken by another wallet
        const existingUser = Object.values(globalUsers.users).find(user => 
            user.platformUsername.toLowerCase() === platformUsername.toLowerCase() && 
            user.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
        );

        if (existingUser) {
            return res.status(400).json({ error: 'Dieser Username ist bereits vergeben' });
        }

        const now = new Date().toISOString();
        
        if (globalUsers.users[userKey]) {
            // Update existing user
            globalUsers.users[userKey] = {
                ...globalUsers.users[userKey],
                platformUsername: platformUsername.trim(),
                gamertags: {
                    playstation: gamertags?.playstation?.trim() || '',
                    xbox: gamertags?.xbox?.trim() || '',
                    steam: gamertags?.steam?.trim() || ''
                },
                updatedAt: now
            };
        } else {
            // Create new user
            globalUsers.users[userKey] = {
                walletAddress: walletAddress,
                platformUsername: platformUsername.trim(),
                gamertags: {
                    playstation: gamertags?.playstation?.trim() || '',
                    xbox: gamertags?.xbox?.trim() || '',
                    steam: gamertags?.steam?.trim() || ''
                },
                stats: {
                    totalWins: 0,
                    gameStats: {
                        fifa: { tournaments: 0, wins: 0 },
                        cod: { tournaments: 0, wins: 0 }
                    }
                },
                createdAt: now,
                updatedAt: now
            };
        }

        await writeGlobalUsers(globalUsers);

        res.status(201).json({
            message: 'Benutzer erfolgreich registriert/aktualisiert',
            user: globalUsers.users[userKey]
        });

    } catch (error) {
        console.error('Fehler beim Registrieren:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Update user profile
app.put('/user/update', async (req, res) => {
    try {
        const { walletAddress, platformUsername, gamertags } = req.body;

        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet-Adresse ist erforderlich' });
        }

        if (!platformUsername || platformUsername.trim().length === 0) {
            return res.status(400).json({ error: 'Plattform-Username ist erforderlich' });
        }

        if (platformUsername.length > 50) {
            return res.status(400).json({ error: 'Username darf maximal 50 Zeichen lang sein' });
        }

        const globalUsers = await readGlobalUsers();
        const userKey = walletAddress.toLowerCase();
        
        // Check if user exists
        if (!globalUsers.users[userKey]) {
            return res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }

        // Check if username is taken by another wallet (case-insensitive)
        const existingUser = Object.values(globalUsers.users).find(user => 
            user.platformUsername.toLowerCase() === platformUsername.toLowerCase() && 
            user.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
        );

        if (existingUser) {
            return res.status(400).json({ error: 'Dieser Username ist bereits vergeben' });
        }

        // Validate gamertag lengths
        if (gamertags) {
            if (gamertags.playstation && gamertags.playstation.length > 50) {
                return res.status(400).json({ error: 'PlayStation Gamertag darf maximal 50 Zeichen lang sein' });
            }
            if (gamertags.xbox && gamertags.xbox.length > 50) {
                return res.status(400).json({ error: 'Xbox Gamertag darf maximal 50 Zeichen lang sein' });
            }
            if (gamertags.steam && gamertags.steam.length > 50) {
                return res.status(400).json({ error: 'Steam Gamertag darf maximal 50 Zeichen lang sein' });
            }
        }

        const now = new Date().toISOString();
        
        // Update user data
        globalUsers.users[userKey] = {
            ...globalUsers.users[userKey],
            platformUsername: platformUsername.trim(),
            gamertags: {
                playstation: gamertags?.playstation?.trim() || '',
                xbox: gamertags?.xbox?.trim() || '',
                steam: gamertags?.steam?.trim() || ''
            },
            updatedAt: now
        };

        await writeGlobalUsers(globalUsers);

        res.json({
            message: 'Profil erfolgreich aktualisiert',
            user: globalUsers.users[userKey]
        });

    } catch (error) {
        console.error('Fehler beim Aktualisieren des Profils:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Get user by wallet address
app.get('/user/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        const globalUsers = await readGlobalUsers();
        const userKey = walletAddress.toLowerCase();
        
        const user = globalUsers.users[userKey];
        
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: 'Benutzer nicht gefunden' });
        }

    } catch (error) {
        console.error('Fehler beim Laden des Benutzers:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Get all global users
app.get('/users/global', async (req, res) => {
    try {
        const globalUsers = await readGlobalUsers();
        
        res.json({
            totalUsers: Object.keys(globalUsers.users).length,
            users: Object.values(globalUsers.users)
        });
        
    } catch (error) {
        console.error('Fehler beim Laden der Benutzer:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// ========== GAME & TOURNAMENT ROUTES ==========

// Get all games
app.get('/games', async (req, res) => {
    try {
        const gamesData = await readGames();
        res.json(gamesData.games);
    } catch (error) {
        console.error('Fehler beim Laden der Spiele:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Get specific game with tournaments
app.get('/games/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        const gamesData = await readGames();
        
        if (!gamesData.games[gameId]) {
            return res.status(404).json({ error: 'Spiel nicht gefunden' });
        }
        
        res.json(gamesData.games[gameId]);
    } catch (error) {
        console.error('Fehler beim Laden des Spiels:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

app.get('/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const globalUsers = await readGlobalUsers();
        
        // Convert users object to array and sort by total wins
        const sortedUsers = Object.values(globalUsers.users)
            .filter(user => user.stats && user.stats.totalWins > 0) // Only users with wins
            .sort((a, b) => b.stats.totalWins - a.stats.totalWins) // Sort descending by wins
            .slice(0, limit) // Limit results
            .map((user, index) => ({
                rank: index + 1,
                platformUsername: user.platformUsername,
                totalWins: user.stats.totalWins,
                gameStats: user.stats.gameStats,
                walletAddress: user.walletAddress.slice(0, 6) + '...' + user.walletAddress.slice(-4) // Shortened for privacy
            }));

        res.json({
            totalPlayers: Object.keys(globalUsers.users).length,
            topPlayers: sortedUsers,
            lastUpdated: new Date().toISOString()
        });

    } catch (error) {
        console.error('Fehler beim Laden der Rangliste:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Register for tournament
app.post('/games/:gameId/tournaments/:tournamentId/register', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const { walletAddress } = req.body;

        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet-Adresse ist erforderlich' });
        }

        // Check if user exists globally
        const globalUsers = await readGlobalUsers();
        const userKey = walletAddress.toLowerCase();
        
        if (!globalUsers.users[userKey]) {
            return res.status(400).json({ error: 'Benutzer muss sich zuerst global registrieren' });
        }

        const gamesData = await readGames();
        
        if (!gamesData.games[gameId]) {
            return res.status(404).json({ error: 'Spiel nicht gefunden' });
        }

        if (!gamesData.games[gameId].tournaments[tournamentId]) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        const tournament = gamesData.games[gameId].tournaments[tournamentId];

        if (tournament.status !== 'registration') {
            return res.status(400).json({ error: 'Registrierung für dieses Turnier ist geschlossen' });
        }

        // Check if already registered
        if (tournament.participants.find(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase())) {
            return res.status(400).json({ error: 'Bereits für dieses Turnier registriert' });
        }

        // Add participant
        const user = globalUsers.users[userKey];
        tournament.participants.push({
            id: Date.now().toString(),
            walletAddress: user.walletAddress,
            platformUsername: user.platformUsername,
            gamertags: user.gamertags,
            registrationTime: new Date().toISOString()
        });

        await writeGames(gamesData);

        res.status(201).json({
            message: 'Erfolgreich für Turnier registriert',
            tournament: tournament
        });

    } catch (error) {
        console.error('Fehler bei der Turnier-Registrierung:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Unregister from tournament
app.post('/games/:gameId/tournaments/:tournamentId/unregister', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const { walletAddress } = req.body;

        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet-Adresse ist erforderlich' });
        }

        const gamesData = await readGames();
        
        if (!gamesData.games[gameId]) {
            return res.status(404).json({ error: 'Spiel nicht gefunden' });
        }

        if (!gamesData.games[gameId].tournaments[tournamentId]) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        const tournament = gamesData.games[gameId].tournaments[tournamentId];

        if (tournament.status !== 'registration') {
            return res.status(400).json({ error: 'Abmeldung nur während der Registrierungsphase möglich' });
        }

        // Find participant
        const participantIndex = tournament.participants.findIndex(p => 
            p.walletAddress.toLowerCase() === walletAddress.toLowerCase()
        );

        if (participantIndex === -1) {
            return res.status(400).json({ error: 'Nicht für dieses Turnier registriert' });
        }

        // Remove participant
        tournament.participants.splice(participantIndex, 1);

        await writeGames(gamesData);

        res.json({
            message: 'Erfolgreich vom Turnier abgemeldet',
            tournament: tournament
        });

    } catch (error) {
        console.error('Fehler bei der Turnier-Abmeldung:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Create new tournament
app.post('/games/:gameId/tournaments', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Turnier-Name ist erforderlich' });
        }

        const gamesData = await readGames();
        
        if (!gamesData.games[gameId]) {
            return res.status(404).json({ error: 'Spiel nicht gefunden' });
        }

        const tournamentId = `tournament_${Date.now()}`;
        const tournament = {
            id: tournamentId,
            name: name.trim(),
            description: description?.trim() || '',
            gameId: gameId,
            status: 'registration',
            participants: [],
            bracket: null,
            createdAt: new Date().toISOString(),
            startedAt: null,
            finishedAt: null,
            winner: null
        };

        gamesData.games[gameId].tournaments[tournamentId] = tournament;

        // Set as active tournament if none exists
        if (!gamesData.games[gameId].activeTournamentId) {
            gamesData.games[gameId].activeTournamentId = tournamentId;
        }

        await writeGames(gamesData);

        res.status(201).json({
            message: 'Turnier erfolgreich erstellt',
            tournament: tournament
        });

    } catch (error) {
        console.error('Fehler beim Erstellen des Turniers:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Start tournament
app.post('/games/:gameId/tournaments/:tournamentId/start', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const gamesData = await readGames();
        
        if (!gamesData.games[gameId] || !gamesData.games[gameId].tournaments[tournamentId]) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        const tournament = gamesData.games[gameId].tournaments[tournamentId];

        if (tournament.participants.length < 2) {
            return res.status(400).json({ error: 'Mindestens 2 Spieler müssen registriert sein' });
        }
        
        if (tournament.status === 'started') {
            return res.status(400).json({ error: 'Turnier wurde bereits gestartet' });
        }
        
        // Create bracket
        const bracket = createSingleEliminationBracket(tournament.participants);
        
        tournament.status = 'started';
        tournament.startedAt = new Date().toISOString();
        tournament.bracket = bracket;
        
        await writeGames(gamesData);
        
        console.log(`Turnier ${tournament.name} gestartet mit ${tournament.participants.length} Spielern`);
        
        res.json({
            message: 'Turnier erfolgreich gestartet',
            tournament: tournament
        });
        
    } catch (error) {
        console.error('Fehler beim Starten des Turniers:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Get tournament details
app.get('/games/:gameId/tournaments/:tournamentId', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const gamesData = await readGames();
        
        if (!gamesData.games[gameId] || !gamesData.games[gameId].tournaments[tournamentId]) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        res.json(gamesData.games[gameId].tournaments[tournamentId]);
        
    } catch (error) {
        console.error('Fehler beim Laden des Turniers:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Submit match result
app.post('/games/:gameId/tournaments/:tournamentId/matches/:matchId/submit-result', async (req, res) => {
    try {
        const { gameId, tournamentId, matchId } = req.params;
        const { submittedBy, walletAddress, score1, score2 } = req.body;
        
        if (!submittedBy || !walletAddress || score1 === undefined || score2 === undefined) {
            return res.status(400).json({ error: 'Alle Felder sind erforderlich' });
        }
        
        if (score1 === score2) {
            return res.status(400).json({ error: 'Unentschieden sind nicht erlaubt' });
        }
        
        const gamesData = await readGames();
        const tournament = gamesData.games[gameId]?.tournaments[tournamentId];
        
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }
        
        // Find match
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
        
        if (submittedBy !== targetMatch.player1.id && submittedBy !== targetMatch.player2.id) {
            return res.status(403).json({ error: 'Sie sind nicht Teil dieses Matches' });
        }
        
        if (!targetMatch.pendingResults) {
            targetMatch.pendingResults = [];
        }
        
        const existingResult = targetMatch.pendingResults.find(r => r.submittedBy === submittedBy);
        if (existingResult) {
            return res.status(400).json({ error: 'Sie haben bereits ein Ergebnis eingereicht' });
        }
        
        targetMatch.pendingResults.push({
            submittedBy,
            walletAddress,
            score1: parseInt(score1),
            score2: parseInt(score2),
            submittedAt: new Date().toISOString()
        });
        
        // Check if both players submitted
        if (targetMatch.pendingResults.length === 2) {
            const result1 = targetMatch.pendingResults[0];
            const result2 = targetMatch.pendingResults[1];
            
            if (result1.score1 === result2.score1 && result1.score2 === result2.score2) {
                // Results match - complete match
                targetMatch.score1 = result1.score1;
                targetMatch.score2 = result1.score2;
                targetMatch.winner = result1.score1 > result1.score2 ? targetMatch.player1 : targetMatch.player2;
                targetMatch.status = 'completed';
                targetMatch.completedAt = new Date().toISOString();
                targetMatch.completedBy = 'auto';
                
                // Check if tournament is complete and update stats
                await checkAndAdvanceRound(gamesData, gameId, tournamentId, roundIndex);
                await writeGames(gamesData);
                
                return res.json({
                    message: 'Ergebnis eingereicht und Match automatisch abgeschlossen',
                    tournament: tournament
                });
            } else {
                targetMatch.pendingResults.forEach(r => r.conflict = true);
                await writeGames(gamesData);
                
                return res.json({
                    message: 'Ergebnis eingereicht - Konflikt erkannt, Admin-Entscheidung erforderlich',
                    conflict: true
                });
            }
        } else {
            await writeGames(gamesData);
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

// Admin: Set match result
app.post('/games/:gameId/tournaments/:tournamentId/matches/:matchId/result', async (req, res) => {
    try {
        const { gameId, tournamentId, matchId } = req.params;
        const { winnerId, score1, score2 } = req.body;
        
        const gamesData = await readGames();
        const tournament = gamesData.games[gameId]?.tournaments[tournamentId];
        
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }
        
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
        
        if (score1 !== undefined && score2 !== undefined) {
            targetMatch.score1 = parseInt(score1);
            targetMatch.score2 = parseInt(score2);
            targetMatch.winner = targetMatch.score1 > targetMatch.score2 ? targetMatch.player1 : targetMatch.player2;
        } else if (winnerId) {
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
        targetMatch.pendingResults = [];
        
        await checkAndAdvanceRound(gamesData, gameId, tournamentId, roundIndex);
        await writeGames(gamesData);
        
        res.json({
            message: 'Match-Ergebnis erfolgreich eingetragen',
            tournament: tournament
        });
        
    } catch (error) {
        console.error('Fehler beim Eintragen des Match-Ergebnisses:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Helper function: Check and advance round
async function checkAndAdvanceRound(gamesData, gameId, tournamentId, currentRoundIndex) {
    const tournament = gamesData.games[gameId].tournaments[tournamentId];
    const currentRound = tournament.bracket.rounds[currentRoundIndex];
    const allMatchesCompleted = currentRound.every(m => m.status === 'completed');
    
    if (allMatchesCompleted) {
        const winners = currentRound.map(m => m.winner);
        const advancingPlayers = [...winners];
        
        if (currentRoundIndex === 0 && tournament.bracket.playersWithByes) {
            advancingPlayers.push(...tournament.bracket.playersWithByes);
            tournament.bracket.playersWithByes = [];
        }
        
        if (advancingPlayers.length === 1) {
            // Tournament finished
            tournament.bracket.isComplete = true;
            tournament.bracket.winner = advancingPlayers[0];
            tournament.status = 'finished';
            tournament.finishedAt = new Date().toISOString();
            tournament.winner = advancingPlayers[0];
            
            // Update global user stats
            await updateUserStats(advancingPlayers[0].walletAddress, gameId, true);
            
            console.log(`Turnier ${tournament.name} beendet! Gewinner: ${advancingPlayers[0].platformUsername}`);
            
        } else if (currentRoundIndex + 1 === tournament.bracket.currentRound) {
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

// Update user statistics
async function updateUserStats(walletAddress, gameId, isWinner) {
    const globalUsers = await readGlobalUsers();
    const userKey = walletAddress.toLowerCase();
    
    if (globalUsers.users[userKey]) {
        const user = globalUsers.users[userKey];
        
        if (isWinner) {
            user.stats.totalWins++;
            user.stats.gameStats[gameId].wins++;
        }
        
        user.stats.gameStats[gameId].tournaments++;
        user.updatedAt = new Date().toISOString();
        
        await writeGlobalUsers(globalUsers);
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.delete('/games/:gameId/tournaments/:tournamentId', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const gamesData = await readGames();
        
        if (!gamesData.games[gameId]) {
            return res.status(404).json({ error: 'Spiel nicht gefunden' });
        }

        if (!gamesData.games[gameId].tournaments[tournamentId]) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        // Delete tournament
        delete gamesData.games[gameId].tournaments[tournamentId];

        // Reset active tournament if this was the active one
        if (gamesData.games[gameId].activeTournamentId === tournamentId) {
            gamesData.games[gameId].activeTournamentId = null;
        }

        await writeGames(gamesData);

        res.json({
            message: 'Turnier erfolgreich gelöscht'
        });

    } catch (error) {
        console.error('Error deleting tournament:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Reset tournament (clear all participants)
app.post('/games/:gameId/tournaments/:tournamentId/reset', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const gamesData = await readGames();
        
        if (!gamesData.games[gameId] || !gamesData.games[gameId].tournaments[tournamentId]) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        const tournament = gamesData.games[gameId].tournaments[tournamentId];

        if (tournament.status !== 'registration') {
            return res.status(400).json({ error: 'Nur Turniere im Registrierungsstatus können zurückgesetzt werden' });
        }

        // Reset tournament data
        tournament.participants = [];
        tournament.bracket = null;
        tournament.winner = null;
        tournament.finishedAt = null;
        tournament.updatedAt = new Date().toISOString();

        await writeGames(gamesData);

        res.json({
            message: 'Turnier erfolgreich zurückgesetzt',
            tournament: tournament
        });

    } catch (error) {
        console.error('Error resetting tournament:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Reset match result
app.post('/games/:gameId/tournaments/:tournamentId/matches/:matchId/reset', async (req, res) => {
    try {
        const { gameId, tournamentId, matchId } = req.params;
        const gamesData = await readGames();
        
        const tournament = gamesData.games[gameId]?.tournaments[tournamentId];
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        // Find match in bracket
        let targetMatch = null;
        let roundIndex = -1;
        let matchIndex = -1;

        for (let i = 0; i < tournament.bracket.rounds.length; i++) {
            const matchIdx = tournament.bracket.rounds[i].findIndex(m => m.id === matchId);
            if (matchIdx !== -1) {
                targetMatch = tournament.bracket.rounds[i][matchIdx];
                roundIndex = i;
                matchIndex = matchIdx;
                break;
            }
        }

        if (!targetMatch) {
            return res.status(404).json({ error: 'Match nicht gefunden' });
        }

        if (targetMatch.status !== 'completed') {
            return res.status(400).json({ error: 'Match ist noch nicht abgeschlossen' });
        }

        // Reset match
        targetMatch.winner = null;
        targetMatch.score1 = null;
        targetMatch.score2 = null;
        targetMatch.status = 'pending';
        targetMatch.completedAt = null;
        targetMatch.completedBy = null;
        targetMatch.pendingResults = [];

        // This is a simplified reset - in a real scenario, you might need to:
        // 1. Remove players from subsequent rounds
        // 2. Reset tournament status if it was completed
        // 3. Update bracket structure appropriately
        
        // For now, we'll just reset the match and let admins handle the consequences
        if (tournament.status === 'finished') {
            tournament.status = 'started';
            tournament.finishedAt = null;
            tournament.winner = null;
            tournament.bracket.isComplete = false;
            tournament.bracket.winner = null;
        }

        await writeGames(gamesData);

        res.json({
            message: 'Match erfolgreich zurückgesetzt',
            tournament: tournament
        });

    } catch (error) {
        console.error('Error resetting match:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Cancel tournament (delete tournament and reset status)
app.post('/games/:gameId/tournaments/:tournamentId/cancel', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const gamesData = await readGames();
        
        if (!gamesData.games[gameId] || !gamesData.games[gameId].tournaments[tournamentId]) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        const tournament = gamesData.games[gameId].tournaments[tournamentId];

        if (tournament.status === 'finished') {
            return res.status(400).json({ error: 'Beendete Turniere können nicht abgebrochen werden' });
        }

        // Delete tournament
        delete gamesData.games[gameId].tournaments[tournamentId];

        // Reset active tournament if this was the active one
        if (gamesData.games[gameId].activeTournamentId === tournamentId) {
            gamesData.games[gameId].activeTournamentId = null;
        }

        await writeGames(gamesData);

        res.json({
            message: `Turnier "${tournament.name}" wurde abgebrochen und gelöscht`
        });

    } catch (error) {
        console.error('Error canceling tournament:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Get tournament participants (additional utility endpoint)
app.get('/games/:gameId/tournaments/:tournamentId/participants', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const gamesData = await readGames();
        
        const tournament = gamesData.games[gameId]?.tournaments[tournamentId];
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        res.json({
            participants: tournament.participants || [],
            count: tournament.participants?.length || 0
        });

    } catch (error) {
        console.error('Error loading participants:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Admin: Force complete tournament (utility endpoint)
app.post('/games/:gameId/tournaments/:tournamentId/force-complete', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const { winnerId } = req.body;
        
        const gamesData = await readGames();
        const tournament = gamesData.games[gameId]?.tournaments[tournamentId];
        
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        if (!winnerId) {
            return res.status(400).json({ error: 'Gewinner-ID ist erforderlich' });
        }

        // Find winner in participants
        const winner = tournament.participants.find(p => p.id === winnerId);
        if (!winner) {
            return res.status(400).json({ error: 'Gewinner nicht in Teilnehmerliste gefunden' });
        }

        // Force complete tournament
        tournament.status = 'finished';
        tournament.finishedAt = new Date().toISOString();
        tournament.winner = winner;
        
        if (tournament.bracket) {
            tournament.bracket.isComplete = true;
            tournament.bracket.winner = winner;
        }

        // Update global user stats
        await updateUserStats(winner.walletAddress, gameId, true);

        await writeGames(gamesData);

        res.json({
            message: 'Turnier erfolgreich abgeschlossen',
            tournament: tournament
        });

    } catch (error) {
        console.error('Error force completing tournament:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Export tournament data
app.get('/games/:gameId/tournaments/:tournamentId/export', async (req, res) => {
    try {
        const { gameId, tournamentId } = req.params;
        const gamesData = await readGames();
        
        const tournament = gamesData.games[gameId]?.tournaments[tournamentId];
        if (!tournament) {
            return res.status(404).json({ error: 'Turnier nicht gefunden' });
        }

        const exportData = {
            tournamentInfo: {
                name: tournament.name,
                description: tournament.description,
                gameId: gameId,
                status: tournament.status,
                createdAt: tournament.createdAt,
                startedAt: tournament.startedAt,
                finishedAt: tournament.finishedAt
            },
            participants: tournament.participants || [],
            bracket: tournament.bracket,
            winner: tournament.winner,
            exportedAt: new Date().toISOString(),
            exportedBy: 'admin'
        };

        res.json(exportData);

    } catch (error) {
        console.error('Error exporting tournament:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Get admin statistics
app.get('/admin/stats', async (req, res) => {
    try {
        const [gamesData, globalUsers] = await Promise.all([
            readGames(),
            readGlobalUsers()
        ]);

        const stats = {
            totalUsers: Object.keys(globalUsers.users).length,
            totalTournaments: 0,
            activeTournaments: 0,
            completedTournaments: 0,
            totalMatches: 0,
            completedMatches: 0
        };

        // Calculate tournament and match statistics
        Object.values(gamesData.games).forEach(game => {
            if (game.tournaments) {
                const tournaments = Object.values(game.tournaments);
                stats.totalTournaments += tournaments.length;
                
                tournaments.forEach(tournament => {
                    if (tournament.status === 'started' || tournament.status === 'registration') {
                        stats.activeTournaments++;
                    } else if (tournament.status === 'finished') {
                        stats.completedTournaments++;
                    }

                    // Count matches
                    if (tournament.bracket && tournament.bracket.rounds) {
                        tournament.bracket.rounds.forEach(round => {
                            stats.totalMatches += round.length;
                            stats.completedMatches += round.filter(m => m.status === 'completed').length;
                        });
                    }
                });
            }
        });

        // User registration statistics
        const today = new Date().toDateString();
        const thisWeek = new Date();
        thisWeek.setDate(thisWeek.getDate() - 7);

        stats.todayRegistrations = Object.values(globalUsers.users).filter(user => 
            user.createdAt && new Date(user.createdAt).toDateString() === today
        ).length;

        stats.weekRegistrations = Object.values(globalUsers.users).filter(user => 
            user.createdAt && new Date(user.createdAt) > thisWeek
        ).length;

        res.json(stats);

    } catch (error) {
        console.error('Error loading admin stats:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

// Server start
app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
    console.log(`Admin-Bereich: http://localhost:${PORT}/admin.html`);
    console.log(`Turnierbaum: http://localhost:${PORT}/tournament.html`);
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