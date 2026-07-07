const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'L\'utilisateur est requis'],
    },
    accountNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Le solde ne peut pas être négatif'],
    },
    type: {
      type: String,
      required: [true, 'Le type de compte est requis'],
      enum: {
        values: ['courant', 'epargne', 'professionnel'],
        message: 'Type de compte invalide. Valeurs acceptées : courant, epargne, professionnel',
      },
      default: 'courant',
    },
    currency: {
      type: String,
      default: 'XAF', // Franc CFA
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Middleware pre-save : génération automatique du numéro de compte
accountSchema.pre('save', function (next) {
  if (!this.accountNumber) {
    // Format : CM + timestamp + 4 chiffres aléatoires
    this.accountNumber = 'CM' + Date.now() + Math.floor(1000 + Math.random() * 9000);
  }
  next();
});

// Méthode : vérifier si le solde est suffisant
accountSchema.methods.hasSufficientFunds = function (amount) {
  return this.balance >= amount;
};

// Méthode : créditer le compte
accountSchema.methods.credit = async function (amount) {
  this.balance += amount;
  return await this.save();
};

// Méthode : débiter le compte
accountSchema.methods.debit = async function (amount) {
  if (!this.hasSufficientFunds(amount)) {
    throw new Error('Solde insuffisant');
  }
  this.balance -= amount;
  return await this.save();
};

module.exports = mongoose.model('Account', accountSchema);
