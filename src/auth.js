import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const sessions = new Map();
const sessionLifetime = 12 * 60 * 60 * 1000;

export async function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return { passwordSalt: salt, passwordHash: hash.toString('hex') };
}

export async function passwordMatches(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const actual = await scrypt(password, user.passwordSalt, 64);
  const expected = Buffer.from(user.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

export function createSession(response, userId, secure = false) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + sessionLifetime });
  response.setHeader('Set-Cookie', `zeitwerk_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${secure ? '; Secure' : ''}`);
}

export function clearSession(request, response) {
  const token = cookieValue(request, 'zeitwerk_session');
  if (token) sessions.delete(token);
  response.setHeader('Set-Cookie', 'zeitwerk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

export function sessionUserId(request) {
  const token = cookieValue(request, 'zeitwerk_session');
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionLifetime;
  return session.userId;
}

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
  if (requirePassword && password.length < 8) throw new Error('Das Passwort muss mindestens 8 Zeichen lang sein.');
  if (!requirePassword && password && password.length < 8) throw new Error('Ein neues Passwort muss mindestens 8 Zeichen lang sein.');
  return { username, name, personnelNumber, password };
}

