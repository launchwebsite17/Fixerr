const US_STATE_CODES = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

const IN_STATE_CODES = {
  ANDHRA: "AP",
  "ANDHRA PRADESH": "AP",
  ARUNACHAL: "AR",
  "ARUNACHAL PRADESH": "AR",
  ASSAM: "AS",
  BIHAR: "BR",
  CHHATTISGARH: "CG",
  GOA: "GA",
  GUJARAT: "GJ",
  HARYANA: "HR",
  HIMACHAL: "HP",
  "HIMACHAL PRADESH": "HP",
  JHARKHAND: "JH",
  KARNATAKA: "KA",
  KERALA: "KL",
  MADHYA: "MP",
  "MADHYA PRADESH": "MP",
  MAHARASHTRA: "MH",
  MANIPUR: "MN",
  MEGHALAYA: "ML",
  MIZORAM: "MZ",
  NAGALAND: "NL",
  ODISHA: "OD",
  ORISSA: "OD",
  PUNJAB: "PB",
  RAJASTHAN: "RJ",
  SIKKIM: "SK",
  TAMIL: "TN",
  "TAMIL NADU": "TN",
  TELANGANA: "TG",
  TRIPURA: "TR",
  UTTARAKHAND: "UK",
  UTTARANCHAL: "UK",
  UTTAR: "UP",
  "UTTAR PRADESH": "UP",
  BENGAL: "WB",
  "WEST BENGAL": "WB",
  DELHI: "DL",
  "NEW DELHI": "DL",
  PUDUCHERRY: "PY",
  PONDICHERRY: "PY",
  CHANDIGARH: "CH",
  LADAKH: "LA",
  JAMMU: "JK",
  "JAMMU AND KASHMIR": "JK",
  "ANDAMAN AND NICOBAR ISLANDS": "AN",
  LAKSHADWEEP: "LD",
  DADRA: "DH",
  "DADRA AND NAGAR HAVELI AND DAMAN AND DIU": "DH",
};

function normalizeCountryCode(country) {
  const raw = String(country || "")
    .trim()
    .toUpperCase();
  if (!raw) return "US";
  if (raw === "INDIA") return "IN";
  if (raw === "UNITED STATES" || raw === "USA" || raw === "US") return "US";
  return raw.slice(0, 2);
}

function normalizeStateCode(state, country) {
  const raw = String(state || "")
    .trim()
    .toUpperCase();
  if (!raw) return "NA";
  if (raw.length === 2 && /^[A-Z]{2}$/.test(raw)) return raw;
  const map =
    normalizeCountryCode(country) === "IN" ? IN_STATE_CODES : US_STATE_CODES;
  if (map[raw]) return map[raw];
  const cleaned = raw.replace(/[^A-Z]/g, " ").trim();
  if (map[cleaned]) return map[cleaned];
  return cleaned.replace(/\s+/g, "").slice(0, 2) || "NA";
}

function phoneLastFive(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return (digits.slice(-5) || "00000").padStart(5, "0");
}

function buildCpUniqueId({ role, country, state, phone }) {
  const prefix =
    String(role || "").toLowerCase() === "professional" ? "P" : "C";
  return `${prefix}${normalizeCountryCode(country)}${normalizeStateCode(state, country)}${phoneLastFive(phone)}`;
}

module.exports = {
  buildCpUniqueId,
  normalizeCountryCode,
  normalizeStateCode,
  phoneLastFive,
};
