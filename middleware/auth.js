const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware de protection des routes
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Utilisateur non trouvé' });
      }

      next();
    } catch (error) {
      return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
    }
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Accès refusé. Veuillez vous connecter.' });
  }
};

// Middleware de restriction par rôle
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Le rôle "${req.user.role}" n'est pas autorisé à accéder à cette ressource`,
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
