import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const sessions = new Map();
const sessionAbsoluteLifetime = 8 * 60 * 60 * 1000;
const sessionIdleLifetime = 30 * 60 * 1000;
const currentScrypt = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

const sessionKey = (token) => crypto.createHash('sha256').update(token).digest('hex');
const cookieName = (secure) => secure ? '__Host-zeitwerk_session' : 'zeitwerk_session';

function scryptOptions(user) {
  if (!user?.passwordN) return undefined;
  return { N: user.passwordN, r: user.passwordR, p: user.passwordP, maxmem: Math.max(64 * 1024 * 1024, 256 * user.passwordN * user.passwordR) };
}

export async function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, currentScrypt);
  return { passwordSalt: salt, passwordHash: hash.toString('hex'), passwordAlgorithm: 'scrypt', passwordN: currentScrypt.N, passwordR: currentScrypt.r, passwordP: currentScrypt.p };
}

export async function passwordMatches(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const actual = await scrypt(password, user.passwordSalt, 64, scryptOptions(user));
  const expected = Buffer.from(user.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function passwordNeedsUpgrade(user) {
  return user?.passwordAlgorithm !== 'scrypt' || user?.passwordN !== currentScrypt.N || user?.passwordR !== currentScrypt.r || user?.passwordP !== currentScrypt.p;
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

export function createSession(request, response, userId, secure = false) {
  clearSession(request, response);
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(sessionKey(token), { userId, idleExpiresAt: now + sessionIdleLifetime, absoluteExpiresAt: now + sessionAbsoluteLifetime });
  response.appendHeader('Set-Cookie', `${cookieName(secure)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionAbsoluteLifetime / 1000}${secure ? '; Secure' : ''}`);
}

export function clearSession(request, response) {
  for (const name of ['zeitwerk_session', '__Host-zeitwerk_session']) {
    const token = cookieValue(request, name);
    if (token) sessions.delete(sessionKey(token));
    response.appendHeader('Set-Cookie', `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${name.startsWith('__Host-') ? '; Secure' : ''}`);
  }
}

export function sessionUserId(request) {
  const token = cookieValue(request, '__Host-zeitwerk_session') || cookieValue(request, 'zeitwerk_session');
  const key = token && sessionKey(token);
  const session = key && sessions.get(key);
  if (!session) return null;
  const now = Date.now();
  if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
    sessions.delete(key);
    return null;
  }
  session.idleExpiresAt = Math.min(now + sessionIdleLifetime, session.absoluteExpiresAt);
  return session.userId;
}

export function clearUserSessions(userId) {
  for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) sessions.delete(key);
}, 10 * 60 * 1000).unref();

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    personnelNumber: user.personnelNumber,
    employeeId: user.employeeId,
    active: user.active,
    role: 'Vollzugriff',
    createdAt: user.createdAt
  };
}

export function validateEmployee(body) {
  const name = String(body.name || '').trim();
  const personnelNumber = String(body.personnelNumber || '').trim();
  if (!name) throw new Error('Bitte einen Namen eintragen.');
  if (name.length > 120) throw new Error('Der Name darf höchstens 120 Zeichen lang sein.');
  if (!personnelNumber) throw new Error('Bitte eine Personalnummer eintragen.');
  if (personnelNumber.length > 40) throw new Error('Die Personalnummer darf höchstens 40 Zeichen lang sein.');
  return { name, personnelNumber };
}

export function validateCredentials(body, requirePassword = true) {
  const username = String(body.username || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const personnelNumber = String(body.personnelNumber || '').trim();
  const password = String(body.password || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Der Benutzername benötigt 3 bis 40 Zeichen und darf nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten.');
  if (!name) throw new Error('Bitte einen Anzeigenamen eintragen.');
  if (!personnelNumber) throw new Error('Bitte eine Personalnummer eintragen.');
  if (requirePassword && password.length < 15) throw new Error('Das Passwort muss mindestens 15 Zeichen lang sein.');
  if (!requirePassword && password && password.length < 15) throw new Error('Ein neues Passwort muss mindestens 15 Zeichen lang sein.');
  if (password.length > 200) throw new Error('Das Passwort darf höchstens 200 Zeichen lang sein.');
  return { username, name, personnelNumber, password };
}
