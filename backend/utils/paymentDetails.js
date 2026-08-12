// The enrollment handler used to build the payment document from
// { ...req.body }, and coursePaymentModel was declared strict: false, so the
// whole posted body was persisted, including the CVV. A card verification
// value must not be stored after authorisation even in a mock checkout, and
// the full card number should not be kept either.
//
// This module reduces whatever the checkout form posts to a summary that is
// safe to keep: the cardholder name, the last four digits, and the expiry.

const FREE_PRICE_VALUES = new Set(["", "0", "free"]);

const digitsOnly = (value) => String(value ?? "").replace(/\D/g, "");

/**
 * True when a course does not require payment.
 *
 * C_price is a free-form string on the course schema, and courseCreation
 * writes the literal "free" when the price is 0, so both shapes appear.
 */
const isFreeCourse = (price) =>
  FREE_PRICE_VALUES.has(String(price ?? "").trim().toLowerCase());

/**
 * Extracts the last four digits of a card number.
 * Returns null when there are not enough digits to be a real card.
 */
const lastFourDigits = (cardNumber) => {
  const digits = digitsOnly(cardNumber);

  if (digits.length < 12 || digits.length > 19) return null;

  return digits.slice(-4);
};

/**
 * Checks that an expiry looks like MM/YY or MM/YYYY and is not in the past.
 */
const isValidExpiry = (expiry, now = new Date()) => {
  const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(
    String(expiry ?? "").trim(),
  );

  if (!match) return false;

  const month = Number(match[1]);
  if (month < 1 || month > 12) return false;

  const rawYear = Number(match[2]);
  const year = match[2].length === 2 ? 2000 + rawYear : rawYear;

  // A card is valid through the end of its expiry month.
  const expiresAt = new Date(year, month, 1);

  return expiresAt > now;
};

/**
 * Validates checkout input and returns only the fields worth persisting.
 *
 * @param {object} input the cardDetails object posted by the client
 * @returns {{ valid: boolean, errors: object, value?: object }}
 */
const buildPaymentSummary = (input = {}, now = new Date()) => {
  const errors = {};

  const cardholdername =
    typeof input.cardholdername === "string"
      ? input.cardholdername.trim()
      : "";

  if (!cardholdername) {
    errors.cardholdername = "Cardholder name is required";
  }

  const cardLast4 = lastFourDigits(input.cardnumber);

  if (!cardLast4) {
    errors.cardnumber = "Card number is not valid";
  }

  const expmonthyear = String(input.expmonthyear ?? "").trim();

  if (!isValidExpiry(expmonthyear, now)) {
    errors.expmonthyear = "Card expiry is missing or in the past";
  }

  // The CVV is checked for shape so an obviously bad form is rejected, then
  // discarded. It is never written to the returned object.
  const cvv = digitsOnly(input.cvvcode);

  if (cvv.length < 3 || cvv.length > 4) {
    errors.cvvcode = "Security code is not valid";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    value: { cardholdername, cardLast4, expmonthyear },
  };
};

const formatPaymentMessage = (errors = {}) => Object.values(errors).join(". ");

module.exports = {
  buildPaymentSummary,
  formatPaymentMessage,
  isFreeCourse,
  isValidExpiry,
  lastFourDigits,
};
