import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TutorialSpotlightProps {
  targetSelector?: string;
  shape?: 'rectangle' | 'circle';
  padding?: number;
  isVisible?: boolean;
}

export const TutorialSpotlight: React.FC<TutorialSpotlightProps> = ({
  targetSelector,
  shape = 'rectangle',
  padding = 12,
  isVisible = true,
}) => {
  const [rect, setRect] = useState<SpotlightRect | null>(null);

  useEffect(() => {
    if (!targetSelector || !isVisible) {
      setRect(null);
      return;
    }

    const updateRect = () => {
      const element = document.querySelector(targetSelector);
      if (element) {
        const bounds = element.getBoundingClientRect();
        setRect({
          top: bounds.top - padding,
          left: bounds.left - padding,
          width: bounds.width + padding * 2,
          height: bounds.height + padding * 2,
        });
      } else {
        setRect(null);
      }
    };

    updateRect();
    
    // Update on resize/scroll
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    
    // Observe for DOM changes
    const observer = new MutationObserver(updateRect);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      observer.disconnect();
    };
  }, [targetSelector, padding, isVisible]);

  if (!isVisible) return null;

  // If no selector provided, show full overlay (for intro screens)
  if (!targetSelector) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
        />
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {rect && (
        <>
          {/* Dark overlay with cutout */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-40 pointer-events-none"
            style={{
              background: `
                linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.85) ${rect.left}px, transparent ${rect.left}px),
                linear-gradient(to left, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.85) ${window.innerWidth - rect.left - rect.width}px, transparent ${window.innerWidth - rect.left - rect.width}px),
                linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.85) ${rect.top}px, transparent ${rect.top}px),
                linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.85) ${window.innerHeight - rect.top - rect.height}px, transparent ${window.innerHeight - rect.top - rect.height}px)
              `,
            }}
          />
          
          {/* Spotlight border/glow */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ 
              opacity: 1, 
              scale: 1,
              boxShadow: [
                '0 0 0 2px hsl(var(--primary))',
                '0 0 20px 4px hsl(var(--primary) / 0.5)',
                '0 0 0 2px hsl(var(--primary))',
              ]
            }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ 
              duration: 0.3,
              boxShadow: {
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }
            }}
            className="fixed z-40 pointer-events-none"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              borderRadius: shape === 'circle' ? '50%' : '12px',
            }}
          />
        </>
      )}
    </AnimatePresence>
  );
};
