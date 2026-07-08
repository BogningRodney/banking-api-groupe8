const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const { protect, authorize } = require('../middleware/auth');

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
// @route   POST /api/transactions/transfer-to-user
// @desc    Effectuer un virement vers le compte d'un autre utilisateur
//          (le destinataire est identifié par son numéro de compte,
//          pas par son ID Mongo — plus réaliste pour un vrai virement)
// @access  Privé
// ─────────────────────────────────────────────
router.post('/transfer-to-user', protect, async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { fromAccountId, toAccountNumber, amount, description } = req.body;

    if (!fromAccountId || !toAccountNumber || !amount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Compte source, numéro de compte destinataire et montant sont requis',
      });
    }

    if (amount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Le montant doit être supérieur à zéro' });
    }

    const fromAccount = await Account.findById(fromAccountId).session(session);
    const toAccount = await Account.findOne({ accountNumber: toAccountNumber }).session(session);

    if (!fromAccount) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Compte source introuvable' });
    }

    if (!toAccount) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Aucun compte trouvé avec ce numéro' });
    }

    // Vérifier que l'utilisateur est propriétaire du compte source
    if (fromAccount.user.toString() !== req.user._id.toString()) {
      await session.abortTransaction();
      return res.status(403).json({ success: false, message: 'Vous n\'êtes pas propriétaire du compte source' });
    }

    if (fromAccount._id.toString() === toAccount._id.toString()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Impossible d\'effectuer un virement vers le même compte',
      });
    }

    // S'assurer qu'il s'agit bien d'un compte appartenant à un AUTRE utilisateur
    if (toAccount.user.toString() === req.user._id.toString()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Ce compte vous appartient déjà. Utilisez /transfer pour un virement entre vos propres comptes.',
      });
    }

    if (!fromAccount.isActive || !toAccount.isActive) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Un ou plusieurs comptes sont inactifs' });
    }

    if (!fromAccount.hasSufficientFunds(amount)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant. Solde disponible : ${fromAccount.balance} ${fromAccount.currency}`,
      });
    }

    const [transaction] = await Transaction.create(
      [
        {
          fromAccount: fromAccount._id,
          toAccount: toAccount._id,
          amount,
          description,
          type: 'virement_externe',
          status: 'en_attente',
        },
      ],
      { session }
    );

    fromAccount.balance -= amount;
    await fromAccount.save({ session });

    toAccount.balance += amount;
    await toAccount.save({ session });

    transaction.status = 'reussi';
    await transaction.save({ session });

    await session.commitTransaction();

    await transaction.populate([
      { path: 'fromAccount', select: 'accountNumber type currency' },
      {
        path: 'toAccount',
        select: 'accountNumber type currency user',
        populate: { path: 'user', select: 'username email' },
      },
    ]);

    res.status(201).json({
      success: true,
      message: 'Virement vers l\'autre utilisateur effectué avec succès',
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
// @route   POST /api/transactions/recharge-request
// @desc    Faire une demande de recharge de compte, à valider par un admin
// @access  Privé
// ─────────────────────────────────────────────
router.post('/recharge-request', protect, async (req, res, next) => {
  try {
    const { accountId, amount, description, method } = req.body;

    if (!accountId || !amount) {
      return res.status(400).json({ success: false, message: 'Compte et montant sont requis' });
    }

    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'Le montant doit être supérieur à zéro' });
    }

    const account = await Account.findById(accountId);

    if (!account) {
      return res.status(404).json({ success: false, message: 'Compte non trouvé' });
    }

    if (account.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Vous n\'êtes pas propriétaire de ce compte' });
    }

    if (!account.isActive) {
      return res.status(400).json({ success: false, message: 'Ce compte est inactif' });
    }

    // La demande est créée en statut "en_attente" et ne modifie PAS le solde :
    // seul un admin peut créditer le compte via la route d'approbation ci-dessous.
    const rechargeRequest = await Transaction.create({
      fromAccount: null,
      toAccount: account._id,
      amount,
      description: description || `Demande de recharge via ${method || 'moyen non précisé'}`,
      type: 'recharge',
      status: 'en_attente',
    });

    await rechargeRequest.populate('toAccount', 'accountNumber type currency');

    res.status(201).json({
      success: true,
      message: 'Demande de recharge envoyée. En attente de validation par un administrateur.',
      data: rechargeRequest,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   GET /api/transactions/recharge-requests/pending
// @desc    Lister les demandes de recharge en attente (admin)
// @access  Privé/Admin
// ─────────────────────────────────────────────
router.get('/recharge-requests/pending', protect, authorize('admin'), async (req, res, next) => {
  try {
    const requests = await Transaction.find({ type: 'recharge', status: 'en_attente' })
      .populate({
        path: 'toAccount',
        select: 'accountNumber type currency user',
        populate: { path: 'user', select: 'username email' },
      })
      .sort({ date: 1 });

    res.status(200).json({ success: true, count: requests.length, data: requests });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// @route   PUT /api/transactions/recharge-request/:id/approve
// @desc    Approuver une demande de recharge (admin) : crédite le compte
// @access  Privé/Admin
// ─────────────────────────────────────────────
router.put('/recharge-request/:id/approve', protect, authorize('admin'), async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const request = await Transaction.findById(req.params.id).session(session);

    if (!request || request.type !== 'recharge') {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Demande de recharge introuvable' });
    }

    if (request.status !== 'en_attente') {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Cette demande a déjà été traitée' });
    }

    const account = await Account.findById(request.toAccount).session(session);

    if (!account) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: 'Compte associé introuvable' });
    }

    account.balance += request.amount;
    await account.save({ session });

    request.status = 'reussi';
    await request.save({ session });

    await session.commitTransaction();

    res.status(200).json({ success: true, message: 'Recharge validée et compte crédité', data: request });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────
// @route   PUT /api/transactions/recharge-request/:id/reject
// @desc    Rejeter une demande de recharge (admin)
// @access  Privé/Admin
// ─────────────────────────────────────────────
router.put('/recharge-request/:id/reject', protect, authorize('admin'), async (req, res, next) => {
  try {
    const { reason } = req.body;

    const request = await Transaction.findById(req.params.id);

    if (!request || request.type !== 'recharge') {
      return res.status(404).json({ success: false, message: 'Demande de recharge introuvable' });
    }

    if (request.status !== 'en_attente') {
      return res.status(400).json({ success: false, message: 'Cette demande a déjà été traitée' });
    }

    request.status = 'echoue';
    if (reason) request.description = `${request.description || ''} — Rejetée : ${reason}`;
    await request.save();

    res.status(200).json({ success: true, message: 'Demande de recharge rejetée', data: request });
  } catch (error) {
    next(error);
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