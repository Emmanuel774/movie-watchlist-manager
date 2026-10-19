const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

const normalizeEmail = (email) => email.trim().toLowerCase();

const isValidEmail = (email) =>
  typeof email === "string" &&
  email.length <= 254 &&
  EMAIL_PATTERN.test(email.trim());

const isStrongPassword = (password) =>
  typeof password === "string" &&
  Array.from(password).length >= MIN_PASSWORD_LENGTH &&
  Buffer.byteLength(password, "utf8") <= MAX_BCRYPT_PASSWORD_BYTES &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password);

module.exports = {
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
};
