const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const { protect } = require('../middleware/auth');

// ─────────────────────────────────────────────
// @route   POST /api/transactions/transfer
// @desc    Effectuer un virement entre deux comptes
// @access  Privé
// ─────────────────────────────────────────────
router.post('/transfer', protect, async (req, res, next) => {
  // Utiliser une session MongoDB pour garantir l'atomicité
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { fromAccountId, toAccountId, amount, description } = req.body;

    if (!fromAccountId || !toAccountId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Compte source, compte destinataire et montant sont requis',
      });
    }

    if (fromAccountId === toAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Impossible d\'effectuer un virement vers le même compte',
      });
    }

    // Charger les deux comptes
    const fromAccount = await Account.findById(fromAccountId).session(session);
    const toAccount = await Account.findById(toAccountId).session(session);

    if (!fromAccount) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Compte source introuvable' });
    }

    if (!toAccount) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Compte destinataire introuvable' });
    }

    // Vérifier que l'utilisateur est propriétaire du compte source
    if (fromAccount.user.toString() !== req.user._id.toString()) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Vous n\'êtes pas propriétaire du compte source' });
    }

    // Vérifier que les deux comptes sont actifs
    if (!fromAccount.isActive || !toAccount.isActive) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Un ou plusieurs comptes sont inactifs' });
    }

    // Vérifier le solde
    if (!fromAccount.hasSufficientFunds(amount)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant. Solde disponible : ${fromAccount.balance} ${fromAccount.currency}`,
      });
    }

    // Créer la transaction avec statut initial "en_attente"
    const [transaction] = await Transaction.create(
      [
        {
          fromAccount: fromAccountId,
          toAccount: toAccountId,
          amount,
          description,
          type: 'virement',
          status: 'en_attente',
        },
      ],
      { session }
    );

    // Débiter le compte source
    fromAccount.balance -= amount;
    await fromAccount.save({ session });

    // Créditer le compte destinataire
    toAccount.balance += amount;
    await toAccount.save({ session });

    // Marquer la transaction comme réussie
    transaction.status = 'reussi';
    await transaction.save({ session });

    // Valider la transaction MongoDB
    await session.commitTransaction();

    await transaction.populate([
      { path: 'fromAccount', select: 'accountNumber type currency' },
      { path: 'toAccount', select: 'accountNumber type currency' },
    ]);

    res.status(201).json({
      success: true,
      message: 'Virement effectué avec succès',
      data: transaction,
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/transactions
// @desc    Historique de toutes les transactions de l'utilisateur
// @access  Privé
// ─────────────────────────────────────────────
router.get('/', protect, async (req, res, next) => {
  try {
    // Trouver les comptes de l'utilisateur
    const userAccounts = await Account.find({ user: req.user._id }).select('_id');
    const accountIds = userAccounts.map((acc) => acc._id);

    const { page = 1, limit = 10, status, startDate, endDate } = req.query;

    // Construire le filtre
    const filter = {
      $or: [{ fromAccount: { $in: accountIds } }, { toAccount: { $in: accountIds } }],
    };

    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .populate('fromAccount', 'accountNumber type')
      .populate('toAccount', 'accountNumber type')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/transactions/:id
// @desc    Obtenir une transaction par son ID
// @access  Privé
// ─────────────────────────────────────────────
router.get('/:id', protect, async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('fromAccount', 'accountNumber type user')
      .populate('toAccount', 'accountNumber type user');

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction non trouvée' });
    }

    // Vérifier que l'utilisateur est impliqué dans cette transaction
    const fromOwner = transaction.fromAccount.user?.toString();
    const toOwner = transaction.toAccount.user?.toString();
    const userId = req.user._id.toString();

    if (fromOwner !== userId && toOwner !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès non autorisé à cette transaction' });
    }

    res.status(200).json({ success: true, data: transaction });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/transactions/account/:accountId
// @desc    Historique des transactions d'un compte spécifique
// @access  Privé
// ─────────────────────────────────────────────
router.get('/account/:accountId', protect, async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.accountId);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Compte non trouvé' });
    }

    if (account.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    const transactions = await Transaction.find({
      $or: [{ fromAccount: req.params.accountId }, { toAccount: req.params.accountId }],
    })
      .populate('fromAccount', 'accountNumber type')
      .populate('toAccount', 'accountNumber type')
      .sort({ date: -1 });

    res.status(200).json({ success: true, count: transactions.length, data: transactions });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
