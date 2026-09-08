// services/taxService.js - India & USA Tax Calculation
const { query } = require('../db');

// Default state tax rates in percentage
const DEFAULT_US_TAXES = {
  'CA': 7.25, 'NY': 4.00, 'TX': 6.25, 'FL': 6.00, 'IL': 6.25,
  'PA': 6.00, 'OH': 5.75, 'GA': 4.00, 'NC': 4.75, 'MI': 6.00,
  'NJ': 6.625, 'VA': 5.30, 'WA': 6.50, 'AZ': 5.60, 'MA': 6.25,
  'TN': 7.00, 'IN': 7.00, 'MO': 4.225, 'MD': 6.00, 'WI': 5.00,
  'CO': 2.90, 'MN': 6.875, 'SC': 6.00, 'AL': 4.00, 'LA': 4.45,
  'KY': 6.00, 'OR': 0.00, 'NH': 0.00, 'DE': 0.00, 'MT': 0.00
};

const DEFAULT_INDIA_GST = 18.0; // 18% GST (9% CGST + 9% SGST or 18% IGST)

async function calculateTax(amount, state, country) {
  const numAmount = parseFloat(amount) || 0;
  if (numAmount <= 0) {
    return { taxAmount: 0, taxRate: 0, taxName: 'Tax', breakdown: [] };
  }

  if (country === 'IN' || country === 'India') {
    const taxRate = DEFAULT_INDIA_GST;
    const taxAmount = Math.round((numAmount * taxRate) / 100);
    const halfTax = (taxAmount / 2).toFixed(2);
    return {
      taxAmount,
      taxRate,
      taxName: 'GST (18%)',
      breakdown: [
        { name: 'CGST (9%)', amount: parseFloat(halfTax) },
        { name: 'SGST (9%)', amount: parseFloat(halfTax) }
      ]
    };
  }

  // USA Tax Calculation
  let taxRate = 5.0; // default US fallback
  const stCode = (state || '').toUpperCase().trim();

  // Try DB state_taxes table first
  try {
    const r = await query(
      `SELECT tax_rate, tax_name FROM state_taxes WHERE UPPER(state_code)=$1 OR UPPER(state_name)=$1 LIMIT 1`,
      [stCode]
    );
    if (r.rows.length > 0) {
      taxRate = parseFloat(r.rows[0].tax_rate);
    } else if (DEFAULT_US_TAXES[stCode] !== undefined) {
      taxRate = DEFAULT_US_TAXES[stCode];
    }
  } catch (err) {
    if (DEFAULT_US_TAXES[stCode] !== undefined) {
      taxRate = DEFAULT_US_TAXES[stCode];
    }
  }

  const taxAmount = parseFloat(((numAmount * taxRate) / 100).toFixed(2));
  return {
    taxAmount,
    taxRate,
    taxName: `${stCode || 'US'} State Sales Tax (${taxRate}%)`,
    breakdown: [
      { name: `State Tax (${stCode || 'US'})`, amount: taxAmount }
    ]
  };
}

module.exports = { calculateTax, DEFAULT_US_TAXES, DEFAULT_INDIA_GST };
