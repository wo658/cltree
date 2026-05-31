import { useState, useCallback } from 'react';
import type { DropPosition } from '@shared/types';

interface DropZoneOverlayProps {
  onDrop: (position: DropPosition) => void;
}

/** Drop zone definition per direction */
const zones: { position: DropPosition; className: string }[] = [
  { position: 'top', className: 'top-0 left-0 right-0 h-1/4' },
  { position: 'bottom', className: 'bottom-0 left-0 right-0 h-1/4' },
  { position: 'left', className: 'top-1/4 left-0 bottom-1/4 w-1/4' },
  { position: 'right', className: 'top-1/4 right-0 bottom-1/4 w-1/4' },
  { position: 'center', className: 'top-1/4 left-1/4 right-1/4 bottom-1/4' },
];

/** Drop zone overlay displayed when dragging over a pane */
export function DropZoneOverlay({ onDrop }: DropZoneOverlayProps) {
  const [activeZone, setActiveZone] = useState<DropPosition | null>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent, zone: DropPosition) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setActiveZone(zone);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, zone: DropPosition) => {
      e.preventDefault();
      e.stopPropagation();
      setActiveZone(null);
      onDrop(zone);
    },
    [onDrop],
  );

  const handleDragLeave = useCallback(() => {
    setActiveZone(null);
  }, []);

  return (
    <div className="absolute inset-0 z-20" onDragLeave={handleDragLeave}>
      {zones.map(({ position, className }) => (
        <div
          key={position}
          className={`absolute ${className} transition-colors ${
            activeZone === position
              ? 'bg-blue-500/20 border-2 border-blue-500/50'
              : ''
          }`}
          onDragOver={(e) => handleDragOver(e, position)}
          onDrop={(e) => handleDrop(e, position)}
        />
      ))}
    </div>
  );
}
