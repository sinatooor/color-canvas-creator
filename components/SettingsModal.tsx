
import React from 'react';
import { ArtStyle, ComplexityLevel, OutlineThickness, GenerationSettings } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: GenerationSettings;
  onSave: (settings: GenerationSettings) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  if (!isOpen) return null;

  const styles: { id: ArtStyle; name: string; icon: string; desc: string }[] = [
    { id: 'classic', name: 'Classic', icon: 'fa-paintbrush', desc: 'Standard paint-by-numbers.' },
    { id: 'stained_glass', name: 'Stained Glass', icon: 'fa-church', desc: 'Bold lines, geometric shapes.' },
    { id: 'mandala', name: 'Mandala', icon: 'fa-dharmachakra', desc: 'Symmetrical & intricate patterns.' },
    { id: 'anime', name: 'Line Art', icon: 'fa-pen-nib', desc: 'Clean, thin lines, detailed.' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden relative flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-2xl font-black text-gray-800">Studio Settings</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 transition-colors">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="p-6 overflow-y-auto no-scrollbar">
          {/* Style Selector */}
          <div className="mb-8">
            <label className="block text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Art Style</label>
            <div className="grid grid-cols-2 gap-3">
              {styles.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSave({ ...settings, style: s.id })}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${
                    settings.style === s.id
                      ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-100 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg mb-3 ${
                    settings.style === s.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 shadow-sm'
                  }`}>
                    <i className={`fa-solid ${s.icon}`}></i>
                  </div>
                  <div className="font-bold text-gray-800">{s.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
              {/* Complexity Slider */}
              <div>
                <label className="block text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
                  Detail Level
                </label>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <input 
                    type="range" 
                    min="0" 
                    max="2" 
                    step="1"
                    value={settings.complexity === 'low' ? 0 : settings.complexity === 'medium' ? 1 : 2}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const map: ComplexityLevel[] = ['low', 'medium', 'high'];
                      onSave({ ...settings, complexity: map[val] });
                    }}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between mt-3 text-xs font-bold text-gray-500">
                    <span className={settings.complexity === 'low' ? 'text-blue-600' : ''}>Low</span>
                    <span className={settings.complexity === 'medium' ? 'text-blue-600' : ''}>Med</span>
                    <span className={settings.complexity === 'high' ? 'text-blue-600' : ''}>High</span>
                  </div>
                </div>
              </div>

              {/* Thickness Slider */}
              <div>
                <label className="block text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
                  Outline Thickness
                </label>
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <input 
                    type="range" 
                    min="0" 
                    max="3" 
                    step="1"
                    value={settings.thickness === 'thin' ? 0 : settings.thickness === 'medium' ? 1 : settings.thickness === 'thick' ? 2 : 3}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const map: OutlineThickness[] = ['thin', 'medium', 'thick', 'heavy'];
                      onSave({ ...settings, thickness: map[val] });
                    }}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gray-800"
                  />
                  <div className="flex justify-between mt-3 text-xs font-bold text-gray-500">
                    <span className={settings.thickness === 'thin' ? 'text-gray-900' : ''}>Thin</span>
                    <span className={settings.thickness === 'medium' ? 'text-gray-900' : ''}>Med</span>
                    <span className={settings.thickness === 'thick' ? 'text-gray-900' : ''}>Thick</span>
                    <span className={settings.thickness === 'heavy' ? 'text-gray-900' : ''}>Bold</span>
                  </div>
                </div>
              </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50">
           <button 
             onClick={onClose}
             className="w-full py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-colors"
           >
             Apply Settings
           </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
