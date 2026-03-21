import axios from 'axios';

export const api = axios.create({ baseURL: '/api/panel' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Mask an API key: show first 8 + '...' + last 4 chars */
export const maskKey = (key: string) => {
  if (!key || key.length <= 14) return key;
  return key.slice(0, 8) + '····' + key.slice(-4);
};
