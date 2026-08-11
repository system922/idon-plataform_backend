// ========== src/config/api.js ==========
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// ✅ Token SOLO en memoria (variable)
let currentToken = null;
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Importante para cookies HttpOnly
});

// Setter para el token (guarda en memoria)
export const setAuthToken = (token) => {
  currentToken = token;
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

// Remover token
export const removeAuthToken = () => {
  currentToken = null;
  delete api.defaults.headers.common['Authorization'];
};

// Interceptor de request - agrega token automáticamente
api.interceptors.request.use(
  (config) => {
    // Si hay token en memoria, agregarlo al header
    if (currentToken) {
      config.headers.Authorization = `Bearer ${currentToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor de response - maneja tokens expirados
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Si es 401 y no es request de refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Si ya está refrescando, esperar
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(token => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Intentar refrescar token usando la cookie HttpOnly
        const response = await api.post('/auth/refresh');
        
        if (response.data?.ok && response.data?.data?.token) {
          const newToken = response.data.data.token;
          setAuthToken(newToken);
          processQueue(null, newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        } else {
          throw new Error('No se pudo renovar el token');
        }
      } catch (refreshError) {
        processQueue(refreshError, null);
        removeAuthToken();
        // Redirigir a login
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;