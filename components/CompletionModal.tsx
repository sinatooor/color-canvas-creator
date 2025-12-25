
import React from 'react';

interface CompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  thumbnailUrl: string;
}

const CompletionModal: React.FC<CompletionModalProps> = ({ isOpen, onClose, thumbnailUrl }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-500">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden relative text-center">
        
        {/* Confetti Background Effect (CSS only) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/4 w-2 h-2 bg-red-500 rounded-full animate-ping"></div>
            <div className="absolute top-10 right-1/4 w-3 h-3 bg-blue-500 rounded-full animate-bounce"></div>
            <div className="absolute bottom-10 left-10 w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        </div>

        <div className="p-8 pt-12">
            <div className="w-24 h-24 bg-gradient-to-br from-yellow-300 to-orange-400 rounded-full flex items-center justify-center text-4xl text-white shadow-lg mx-auto mb-6 animate-bounce">
                <i className="fa-solid fa-trophy"></i>
            </div>
            
            <h2 className="text-3xl font-black text-gray-800 mb-2">Masterpiece!</h2>
            <p className="text-gray-500 font-medium mb-6">
                You've completed the artwork. It has been saved to your gallery as Finished.
            </p>

            <div className="relative aspect-square w-48 mx-auto mb-8 rounded-2xl overflow-hidden shadow-lg border-4 border-white rotate-3 hover:rotate-0 transition-transform duration-300">
                <img src={thumbnailUrl} alt="Finished Art" className="w-full h-full object-cover" />
            </div>

            <button
                onClick={onClose}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2"
            >
                <i className="fa-solid fa-check"></i> Great Job!
            </button>
        </div>
      </div>
    </div>
  );
};

export default CompletionModal;
