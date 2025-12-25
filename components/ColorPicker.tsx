
import React from 'react';
import { Color } from '../types';

interface ColorPickerProps {
  selectedColor: string;
  onSelectColor: (hex: string) => void;
  palette: Color[];
}

const ColorPicker: React.FC<ColorPickerProps> = ({ selectedColor, onSelectColor, palette }) => {
  
  // Helper to determine if text should be black or white based on background color
  const getContrastColor = (hex: string) => {
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128 ? '#000000' : '#ffffff';
  };

  return (
    <div className="flex flex-wrap gap-2 justify-center p-4 bg-white rounded-xl shadow-inner border border-gray-100 max-h-48 overflow-y-auto no-scrollbar">
      {palette.map((color, index) => {
        const textColor = getContrastColor(color.hex);
        return (
          <button
            key={`${color.hex}-${index}`}
            onClick={() => onSelectColor(color.hex)}
            className={`w-10 h-10 rounded-full transition-all transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-blue-200 border-2 shrink-0 flex items-center justify-center font-bold text-xs ${
              selectedColor === color.hex ? 'border-gray-800 scale-110 shadow-lg' : 'border-transparent'
            }`}
            style={{ 
              backgroundColor: color.hex,
              color: textColor,
              textShadow: textColor === '#ffffff' ? '0px 0px 2px rgba(0,0,0,0.5)' : 'none'
            }}
            title={color.name || color.hex}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
};

export default ColorPicker;
