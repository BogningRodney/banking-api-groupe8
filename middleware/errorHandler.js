// Middleware de gestion centralisée des erreurs
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  console.error('❌ Erreur :', err);

  // Erreur ObjectId invalide (CastError Mongoose)
  if (err.name === 'CastError') {
    error.message = `Ressource introuvable avec l'id : ${err.value}`;
    return res.status(404).json({ success: false, message: error.message });
  }

  // Erreur de duplication (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error.message = `La valeur "${err.keyValue[field]}" existe déjà pour le champ "${field}"`;
    return res.status(400).json({ success: false, message: error.message });
  }

  // Erreur de validation Mongoose
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({ success: false, message: messages.join('. ') });
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Erreur interne du serveur',
  });
};

module.exports = errorHandler;
