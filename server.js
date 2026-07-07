const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// Charger les variables d'environnement
dotenv.config();

// Connexion à la base de données
connectDB();

const app = express();

app.use(express.json());

// ─────────────────────────────────────────────
// Middlewares globaux
// ─────────────────────────────────────────────
app.use(cors({
  origin: "http://localhost:5173" || 'http://localhost:3000' ,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Logger de requêtes (développement)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
app.use('/api/users',        require('./routes/userRoutes'));
app.use('/api/accounts',     require('./routes/accountRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));

// Route de santé (health check)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: '🏦 BankingApp API est opérationnelle',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Route 404 pour les endpoints non définis
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} non trouvée`,
  });
});

// ─────────────────────────────────────────────
// Middleware de gestion des erreurs (doit être en dernier)
// ─────────────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────
// Démarrage du serveur
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Serveur démarré en mode "${process.env.NODE_ENV}" sur le port ${PORT}`);
  console.log(`📡 API disponible sur : http://localhost:${PORT}/api`);
  console.log(`🏥 Health check     : http://localhost:${PORT}/api/health\n`);
});

// Gestion des erreurs non capturées
process.on('unhandledRejection', (err) => {
  console.error(`❌ Erreur non gérée : ${err.message}`);
  server.close(() => process.exit(1));
});
