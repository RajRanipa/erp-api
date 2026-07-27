import { ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS } from './tokenUtils.js';

export function getAuthCookieOptions() {
  const sameSite = String(
    process.env.SAME_SITE || process.env.Strict_Mode || 'lax',
  ).toLowerCase();
  const domain = process.env.COOKIE_DOMAIN || process.env.Domain_Name || '';
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: ['lax', 'strict', 'none'].includes(sameSite) ? sameSite : 'lax',
    path: '/',
  };

  if (domain && !domain.includes('localhost')) options.domain = domain;
  return options;
}

export function setAuthCookies(res, { accessToken, refreshToken }) {
  const options = getAuthCookieOptions();
  res.cookie('accessToken', accessToken, {
    ...options,
    maxAge: ACCESS_TOKEN_EXPIRE_MINUTES * 60 * 1000,
  });
  res.cookie('refreshToken', refreshToken, {
    ...options,
    maxAge: REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res) {
  const options = getAuthCookieOptions();
  res.clearCookie('accessToken', options);
  res.clearCookie('refreshToken', options);
}

