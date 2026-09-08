// controllers/walletController.js
const { query } = require('../db');

exports.getWallet = async (req, res) => {
  try {
    const r = await query('SELECT wallet_balance FROM users WHERE id=$1', [req.user.id]);
    res.json({ balance: r.rows[0]?.wallet_balance || 0 });
  } catch (e) {
    res.status(500).json({ error: 'Could not load wallet.' });
  }
};

exports.topupWallet = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || +amount <= 0) return res.status(400).json({ error: 'Invalid amount.' });

    const r = await query('UPDATE users SET wallet_balance=COALESCE(wallet_balance,0)+$1 WHERE id=$2 RETURNING wallet_balance', [+amount, req.user.id]);
    await query('INSERT INTO notifs (type,msg) VALUES ($1,$2)', ['wallet', `Customer wallet topped up: ${amount}`]);
    res.json({ success: true, balance: r.rows[0].wallet_balance });
  } catch (e) {
    res.status(500).json({ error: 'Could not top up wallet.' });
  }
};
