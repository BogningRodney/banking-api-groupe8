const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// Helper : générer un token JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// ─────────────────────────────────────────────
// @route   POST /api/users/register
// @desc    Inscription d'un nouvel utilisateur
// @access  Public
// ─────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    const user = await User.create({ username, email, password });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      token,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   POST /api/users/login
// @desc    Connexion d'un utilisateur
// @access  Public
// ─────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Ce compte est désactivé' });
    }

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Connexion réussie',
      token,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/users/me
// @desc    Obtenir le profil de l'utilisateur connecté
// @access  Privé
// ─────────────────────────────────────────────
router.get('/me', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/users
// @desc    Obtenir tous les utilisateurs (admin)
// @access  Privé/Admin
// ─────────────────────────────────────────────
router.get('/', protect, authorize('admin'), async (req, res, next) => {
  try {
    const users = await User.find().select('-password');
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   PUT /api/users/:id
// @desc    Mettre à jour un utilisateur
// @access  Privé
// ─────────────────────────────────────────────
router.put('/:id', protect, async (req, res, next) => {
  try {
    // Empêcher la modification du mot de passe via cette route
    const { password, ...updateData } = req.body;

    const user = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   DELETE /api/users/:id
// @desc    Désactiver un utilisateur (soft delete)
// @access  Privé/Admin
// ─────────────────────────────────────────────
router.delete('/:id', protect, authorize('admin'), async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    res.status(200).json({ success: true, message: 'Utilisateur désactivé avec succès' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
