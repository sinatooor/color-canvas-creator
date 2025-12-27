
import { supabase } from '../src/integrations/supabase/client';
import { User, SavedProject, ProjectBundle, TimelapseFrame } from '../types';
import type { TablesInsert, TablesUpdate } from '../src/integrations/supabase/types';

export const storageService = {
  // --- AUTH ---
  
  async login(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      throw new Error(error.message);
    }
    
    if (!data.user) {
      throw new Error('Login failed');
    }
    
    // Get profile data
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();
    
    return {
      id: data.user.id,
      name: profile?.name || data.user.email || 'User',
      email: data.user.email || '',
      avatar: profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.user.id}`
    };
  },

  async signup(name: string, email: string, password: string): Promise<User> {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          name: name
        }
      }
    });
    
    if (error) {
      if (error.message.includes('already registered')) {
        throw new Error('This email is already registered. Please sign in instead.');
      }
      throw new Error(error.message);
    }
    
    if (!data.user) {
      throw new Error('Signup failed');
    }
    
    return {
      id: data.user.id,
      name: name,
      email: data.user.email || email,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.user.id}`
    };
  },

  async getCurrentUser(): Promise<User | null> {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.user) {
      return null;
    }
    
    // Get profile data
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    
    return {
      id: session.user.id,
      name: profile?.name || session.user.email || 'User',
      email: session.user.email || '',
      avatar: profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`
    };
  },

  async logout(): Promise<void> {
    await supabase.auth.signOut();
  },

  // Subscribe to auth changes
  onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        // Defer profile fetch to avoid deadlock
        setTimeout(async () => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();
          
          callback({
            id: session.user.id,
            name: profile?.name || session.user.email || 'User',
            email: session.user.email || '',
            avatar: profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`
          });
        }, 0);
      } else {
        callback(null);
      }
    });
  },

  // --- PROJECTS ---

  async saveProject(project: Omit<SavedProject, 'id' | 'createdAt'>): Promise<SavedProject> {
    const insertData: TablesInsert<'projects'> = {
      user_id: project.userId,
      name: project.name,
      thumbnail_url: project.thumbnailUrl || null,
      bundle: JSON.parse(JSON.stringify(project.bundle)),
      current_state_url: project.currentStateUrl || null,
      timelapse_log: project.timelapseLog ? JSON.parse(JSON.stringify(project.timelapseLog)) : null,
      region_colors: project.regionColors ? JSON.parse(JSON.stringify(project.regionColors)) : null,
      is_finished: project.isFinished || false
    };
    
    const { data, error } = await supabase
      .from('projects')
      .insert(insertData)
      .select()
      .single();
    
    if (error) {
      throw new Error(error.message);
    }
    
    return {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      thumbnailUrl: data.thumbnail_url || '',
      bundle: data.bundle as unknown as ProjectBundle,
      currentStateUrl: data.current_state_url || undefined,
      timelapseLog: data.timelapse_log as unknown as TimelapseFrame[] || undefined,
      regionColors: data.region_colors as unknown as Record<number, string> || undefined,
      isFinished: data.is_finished || false,
      createdAt: new Date(data.created_at).getTime(),
      updatedAt: new Date(data.updated_at).getTime()
    };
  },

  async updateProject(projectId: string, updates: Partial<SavedProject>): Promise<SavedProject> {
    const updateData: Record<string, unknown> = {};
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.thumbnailUrl !== undefined) updateData.thumbnail_url = updates.thumbnailUrl;
    if (updates.currentStateUrl !== undefined) updateData.current_state_url = updates.currentStateUrl;
    if (updates.timelapseLog !== undefined) updateData.timelapse_log = updates.timelapseLog;
    if (updates.regionColors !== undefined) updateData.region_colors = updates.regionColors;
    if (updates.isFinished !== undefined) updateData.is_finished = updates.isFinished;
    
    const { data, error } = await supabase
      .from('projects')
      .update(updateData)
      .eq('id', projectId)
      .select()
      .single();
    
    if (error) {
      throw new Error(error.message);
    }
    
    return {
      id: data.id,
      userId: data.user_id,
      name: data.name,
      thumbnailUrl: data.thumbnail_url || '',
      bundle: data.bundle as unknown as ProjectBundle,
      currentStateUrl: data.current_state_url || undefined,
      timelapseLog: data.timelapse_log as unknown as TimelapseFrame[] || undefined,
      regionColors: data.region_colors as unknown as Record<number, string> || undefined,
      isFinished: data.is_finished || false,
      createdAt: new Date(data.created_at).getTime(),
      updatedAt: new Date(data.updated_at).getTime()
    };
  },

  async getUserProjects(userId: string): Promise<SavedProject[]> {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    
    if (error) {
      throw new Error(error.message);
    }
    
    return (data || []).map(row => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      thumbnailUrl: row.thumbnail_url || '',
      bundle: row.bundle as unknown as ProjectBundle,
      currentStateUrl: row.current_state_url || undefined,
      timelapseLog: row.timelapse_log as unknown as TimelapseFrame[] || undefined,
      regionColors: row.region_colors as unknown as Record<number, string> || undefined,
      isFinished: row.is_finished || false,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime()
    }));
  },

  async deleteProject(projectId: string): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId);
    
    if (error) {
      throw new Error(error.message);
    }
  }
};
