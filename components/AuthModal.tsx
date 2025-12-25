
import React, { useState } from 'react';
import { storageService } from '../services/storageService';
import { User } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let user: User;
      if (isLogin) {
        user = await storageService.login(email, password);
      } else {
        if (!name) throw new Error('Name is required');
        user = await storageService.signup(name, email, password);
      }
      onLoginSuccess(user);
      onClose();
      // Reset form
      setPassword('');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <i className="fa-solid fa-xmark text-xl"></i>
        </button>

        <div className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-black text-gray-800 mb-2">
              {isLogin ? 'Welcome Back' : 'Join FifoColor.AI'}
            </h2>
            <p className="text-gray-500">
              {isLogin ? 'Sign in to access your gallery' : 'Create an account to save your art'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                  placeholder="Van Gogh"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
            )}
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                placeholder="artist@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all font-mono"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <i className="fa-solid fa-circle-notch animate-spin"></i> : (isLogin ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); setPassword(''); }}
              className="text-sm font-semibold text-gray-500 hover:text-blue-600 transition-colors"
            >
              {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
