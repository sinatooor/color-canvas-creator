
import React, { useEffect, useState } from 'react';
import { SavedProject, User } from '../types';
import { storageService } from '../services/storageService';

interface ProjectsGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSelectProject: (project: SavedProject) => void;
}

const ProjectsGallery: React.FC<ProjectsGalleryProps> = ({ isOpen, onClose, user, onSelectProject }) => {
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && user) {
      loadProjects();
    }
  }, [isOpen, user]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await storageService.getUserProjects(user.id);
      setProjects(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Delete this artwork?')) {
        await storageService.deleteProject(id);
        loadProjects();
    }
  };

  const handleRedo = async (e: React.MouseEvent, project: SavedProject) => {
    e.stopPropagation();
    
    // Create a new project instance based on the old one, but clean state
    const newProject: Omit<SavedProject, 'id' | 'createdAt'> = {
        userId: user.id,
        name: `${project.name} (Redo)`,
        thumbnailUrl: project.thumbnailUrl, // Use original thumbnail preview
        bundle: project.bundle, // Reuse the bundle
        // Explicitly undefined currentStateUrl to start fresh
        currentStateUrl: undefined, 
        isFinished: false 
    };

    try {
        const saved = await storageService.saveProject(newProject);
        onSelectProject(saved);
    } catch (err) {
        console.error("Failed to redo project", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-gray-50 rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden relative flex flex-col">
        <div className="p-6 bg-white border-b border-gray-200 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-2xl font-black text-gray-800">Your Gallery</h2>
            <p className="text-sm text-gray-500">{projects.length} Masterpieces</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-grow">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4">
              <i className="fa-solid fa-circle-notch animate-spin text-3xl"></i>
              <p>Loading your art...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-4">
              <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center text-3xl">
                <i className="fa-solid fa-image"></i>
              </div>
              <p className="font-medium">No saved projects yet.</p>
              <button onClick={onClose} className="text-blue-600 font-bold hover:underline">Start Creating</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {projects.map((project) => (
                <div 
                  key={project.id} 
                  onClick={() => onSelectProject(project)}
                  className="group relative aspect-square bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all"
                >
                  <img 
                    src={project.isFinished ? project.currentStateUrl : project.thumbnailUrl} 
                    alt={project.name} 
                    className="w-full h-full object-cover" 
                  />
                  
                  {project.isFinished && (
                      <div className="absolute top-2 left-2 bg-yellow-400 text-yellow-900 text-[10px] font-black px-2 py-1 rounded-full shadow-sm flex items-center gap-1">
                          <i className="fa-solid fa-star"></i> DONE
                      </div>
                  )}
                  
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <p className="text-white font-bold truncate">{project.name}</p>
                    <p className="text-xs text-gray-300">{new Date(project.createdAt).toLocaleDateString()}</p>
                    
                    {/* Redo Button */}
                    {project.isFinished && (
                        <button
                            onClick={(e) => handleRedo(e, project)}
                            className="mt-2 w-full py-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg text-white text-xs font-bold border border-white/40"
                        >
                            <i className="fa-solid fa-rotate-right mr-1"></i> Redo
                        </button>
                    )}
                  </div>

                  <button 
                    onClick={(e) => handleDelete(e, project.id)}
                    className="absolute top-2 right-2 w-8 h-8 bg-white/20 backdrop-blur-md text-white hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete"
                  >
                    <i className="fa-solid fa-trash text-xs"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectsGallery;