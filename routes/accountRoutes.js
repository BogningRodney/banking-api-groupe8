const express = require('express');
const router = express.Router();
const Account = require('../models/Account');
const { protect, authorize } = require('../middleware/auth');

// ─────────────────────────────────────────────
// @route   POST /api/accounts
// @desc    Créer un nouveau compte bancaire
// @access  Privé
// ─────────────────────────────────────────────
router.post('/', protect, async (req, res, next) => {
  try {
    const { type, initialBalance, currency, accountNumber, } = req.body;

    const account = await Account.create({
      user: req.user._id,
      type: type || 'courant',
      balance: initialBalance || 0,
      currency: currency || 'XAF',
      accountNumber,
    });

    await account.populate('user', 'username email');

    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès',
      data: account,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/accounts
// @desc    Obtenir tous les comptes de l'utilisateur connecté
// @access  Privé
// ─────────────────────────────────────────────
router.get('/', protect, async (req, res, next) => {
  try {
    const query = req.user.role === 'admin' ? {} : { user: req.user._id };
    const accounts = await Account.find(query).populate('user', 'username email');

    res.status(200).json({
      success: true,
      count: accounts.length,
      data: accounts,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/accounts/:id
// @desc    Obtenir un compte par son ID
// @access  Privé
// ─────────────────────────────────────────────
router.get('/:id', protect, async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id).populate('user', 'username email');

    if (!account) {
      return res.status(404).json({ success: false, message: 'Compte non trouvé' });
    }

    // Vérifier que l'utilisateur est propriétaire ou admin
    if (account.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès non autorisé à ce compte' });
    }

    res.status(200).json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/accounts/:id/balance
// @desc    Consulter le solde d'un compte
// @access  Privé
// ─────────────────────────────────────────────
router.get('/:id/balance', protect, async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Compte non trouvé' });
    }

    if (account.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    res.status(200).json({
      success: true,
      data: {
        accountNumber: account.accountNumber,
        balance: account.balance,
        currency: account.currency,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   PUT /api/accounts/:id
// @desc    Mettre à jour un compte (type)
// @access  Privé
// ─────────────────────────────────────────────
router.put('/:id', protect, async (req, res, next) => {
  try {
    const { type, currency } = req.body;

    const account = await Account.findById(req.params.id);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Compte non trouvé' });
    }

    if (account.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    const updated = await Account.findByIdAndUpdate(
      req.params.id,
      { type, currency },
      { new: true, runValidators: true }
    );

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   DELETE /api/accounts/:id
// @desc    Fermer (désactiver) un compte
// @access  Privé
// ─────────────────────────────────────────────
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Compte non trouvé' });
    }

    if (account.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    if (account.balance > 0) {
      return res.status(400).json({
        success: false,
        message: `Impossible de fermer ce compte : solde restant de ${account.balance} ${account.currency}`,
      });
    }

    await Account.findByIdAndUpdate(req.params.id, { isActive: false });

    res.status(200).json({ success: true, message: 'Compte fermé avec succès' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
