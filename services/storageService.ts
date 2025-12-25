
import { User, SavedProject } from '../types';

// Keys for localStorage
const USERS_KEY = 'fifocolor_users';
const PROJECTS_KEY = 'fifocolor_projects';
const CURRENT_USER_KEY = 'fifocolor_current_user_id';

// Internal type for storage including password
interface StoredUser extends User {
  password?: string;
}

// Mock delay to simulate network
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const storageService = {
  // --- AUTH ---
  
  async login(email: string, password: string): Promise<User> {
    await delay(500);
    const users: StoredUser[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      throw new Error('User not found. Please sign up.');
    }
    
    // Verify password if the user has one
    if (user.password && user.password !== password) {
      throw new Error('Incorrect password.');
    }
    
    localStorage.setItem(CURRENT_USER_KEY, user.id);
    
    // Return User without password
    const { password: _, ...safeUser } = user;
    return safeUser;
  },

  async signup(name: string, email: string, password: string): Promise<User> {
    await delay(500);
    const users: StoredUser[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    
    if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('Email already exists.');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    const newUser: StoredUser = {
      id: crypto.randomUUID(),
      name,
      email,
      password,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`
    };

    users.push(newUser);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    localStorage.setItem(CURRENT_USER_KEY, newUser.id);
    
    // Return User without password
    const { password: _, ...safeUser } = newUser;
    return safeUser;
  },

  async getCurrentUser(): Promise<User | null> {
    const userId = localStorage.getItem(CURRENT_USER_KEY);
    if (!userId) return null;
    
    const users: StoredUser[] = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    const user = users.find((u) => u.id === userId);
    
    if (!user) return null;
    
    const { password: _, ...safeUser } = user;
    return safeUser;
  },

  async logout(): Promise<void> {
    localStorage.removeItem(CURRENT_USER_KEY);
  },

  // --- PROJECTS ---

  async saveProject(project: Omit<SavedProject, 'id' | 'createdAt'>): Promise<SavedProject> {
    await delay(600);
    const projects = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    
    const newProject: SavedProject = {
      ...project,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    projects.push(newProject);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    return newProject;
  },

  async updateProject(projectId: string, updates: Partial<SavedProject>): Promise<SavedProject> {
    // No artificial delay for auto-save to keep UI snappy
    const projects: SavedProject[] = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    const index = projects.findIndex(p => p.id === projectId);
    
    if (index === -1) {
      throw new Error('Project not found');
    }

    const updatedProject = {
      ...projects[index],
      ...updates,
      updatedAt: Date.now()
    };

    projects[index] = updatedProject;
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    return updatedProject;
  },

  async getUserProjects(userId: string): Promise<SavedProject[]> {
    await delay(400);
    const projects = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    return projects
      .filter((p: SavedProject) => p.userId === userId)
      .sort((a: SavedProject, b: SavedProject) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  },

  async deleteProject(projectId: string): Promise<void> {
    await delay(300);
    let projects = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    projects = projects.filter((p: SavedProject) => p.id !== projectId);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }
};
