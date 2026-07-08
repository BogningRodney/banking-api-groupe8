const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    fromAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Le compte source est requis'],
    },
    toAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'Le compte destinataire est requis'],
    },
    amount: {
      type: Number,
      required: [true, 'Le montant est requis'],
      min: [1, 'Le montant doit être supérieur à 0'],
    },
    date: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['en_attente', 'reussi', 'echoue', 'annule'],
      default: 'en_attente',
    },
    type: {
      type: String,
      enum: ['virement', 'depot', 'retrait', 'virement_externe'],
      default: 'virement',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, 'La description ne peut dépasser 200 caractères'],
    },
    reference: {
      type: String,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

// Middleware pre-save : génération de la référence unique
transactionSchema.pre('save', function (next) {
  if (!this.reference) {
    this.reference = 'TXN-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
  }
  next();
});

// Index pour accélérer les recherches par date et status
transactionSchema.index({ date: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ fromAccount: 1, toAccount: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
