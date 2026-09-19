import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../services/types'

// Who is signed in, for the UI only. The session itself lives in httpOnly
// cookies that JavaScript can't read, so nothing secret is stored here.

interface AuthState {
  user: User | null
  setUser: (user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    {
      name: 'researchgpt-auth',
      // Older versions stored a token here; keep only the user.
      partialize: (s) => ({ user: s.user }),
    },
  ),
)
