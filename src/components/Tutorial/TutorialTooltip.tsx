import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorialProgress } from './TutorialProgress';
import { TutorialNavigation } from './TutorialNavigation';
import { ExitTutorialDialog } from './ExitTutorialDialog';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TutorialTooltipProps {
  step: number;
  totalSteps: number;
  title: string;
  content: string;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
  canGoBack: boolean;
  canGoNext: boolean;
  nextButtonLabel?: string;
  validationError?: string | null;
  validationSuccess?: string | null;
  isInteractive?: boolean;
  position?: 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
}

export const TutorialTooltip: React.FC<TutorialTooltipProps> = ({
  step,
  totalSteps,
  title,
  content,
  onNext,
  onBack,
  onExit,
  canGoBack,
  canGoNext,
  nextButtonLabel = 'Next',
  validationError,
  validationSuccess,
  isInteractive,
  position = 'bottom-right',
}) => {
  const [showExitDialog, setShowExitDialog] = useState(false);

  const handleExitClick = () => {
    setShowExitDialog(true);
  };

  const handleConfirmExit = () => {
    setShowExitDialog(false);
    onExit();
  };

  // Parse content for markdown-like formatting
  const formatContent = (text: string) => {
    return text.split('\n').map((line, index) => {
      // Bold text
      const formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-primary font-semibold">$1</strong>');
      
      // Emoji bullets stay as-is
      if (line.trim().startsWith('•') || line.trim().startsWith('✅') || line.trim().startsWith('🏨') || line.trim().startsWith('💰') || line.trim().startsWith('📈') || line.trim().startsWith('💎') || line.trim().startsWith('💼') || line.trim().startsWith('💵') || line.trim().startsWith('🥇') || line.trim().startsWith('🥈') || line.trim().startsWith('🔵') || line.trim().startsWith('🔄') || line.trim().startsWith('1️⃣') || line.trim().startsWith('2️⃣') || line.trim().startsWith('3️⃣')) {
        return (
          <p key={index} className="ml-1" dangerouslySetInnerHTML={{ __html: formattedLine }} />
        );
      }
      
      if (line.trim() === '') {
        return <br key={index} />;
      }
      
      return (
        <p key={index} dangerouslySetInnerHTML={{ __html: formattedLine }} />
      );
    });
  };

  const isLastStep = step === totalSteps;

  // Render centered tooltip for intro steps
  if (position === 'center') {
    return (
      <>
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="bg-card border border-border rounded-xl shadow-lg p-5 w-full max-w-lg max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-3 shrink-0">
              <div className="flex-1 pr-4">
                <TutorialProgress currentStep={step} totalSteps={totalSteps} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 -mt-1 -mr-1"
                onClick={handleExitClick}
                aria-label="Exit tutorial"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Title */}
            <h3 className="text-lg font-semibold mb-3 shrink-0">{title}</h3>

            {/* Scrollable Content Area */}
            <ScrollArea className="flex-1 min-h-0 pr-4">
              <div className="text-sm text-muted-foreground space-y-1.5 mb-4">
                {formatContent(content)}
              </div>

              {/* Interactive Hint */}
              {isInteractive && !validationSuccess && (
                <p className="text-xs text-primary mb-4 italic">
                  ☝️ Complete the action above to continue
                </p>
              )}
            </ScrollArea>

            {/* Navigation - Always visible at bottom */}
            <div className="shrink-0 pt-2">
              <TutorialNavigation
                onNext={onNext}
                onBack={onBack}
                canGoNext={canGoNext}
                canGoBack={canGoBack}
                nextLabel={nextButtonLabel}
                isLastStep={isLastStep}
              />
            </div>
          </motion.div>
        </div>

        <ExitTutorialDialog
          open={showExitDialog}
          onOpenChange={setShowExitDialog}
          onConfirm={handleConfirmExit}
        />
      </>
    );
  }

  // Render corner-positioned tooltip
  // Use a flex container anchored to the corner
  const isBottom = position === 'bottom-right' || position === 'bottom-left';
  const isLeft = position === 'bottom-left' || position === 'top-left';

  return (
    <>
      <div 
        className={cn(
          "fixed z-50 flex flex-col max-w-sm w-[calc(100%-2rem)] sm:w-96",
          isLeft ? "left-4" : "right-4",
          "top-4 bottom-4"
        )}
        style={{ pointerEvents: 'none' }}
      >
        {/* Spacer to push content to bottom/top */}
        {isBottom && <div className="flex-1" />}
        
        <motion.div
          initial={{ opacity: 0, y: isBottom ? 20 : -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: isBottom ? 20 : -20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="bg-card border border-border rounded-xl shadow-lg p-5 flex flex-col max-h-[70vh] overflow-hidden"
          style={{ pointerEvents: 'auto' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-3 shrink-0">
            <div className="flex-1 pr-4">
              <TutorialProgress currentStep={step} totalSteps={totalSteps} />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -mt-1 -mr-1"
              onClick={handleExitClick}
              aria-label="Exit tutorial"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold mb-3 shrink-0">{title}</h3>

          {/* Scrollable Content Area */}
          <ScrollArea className="flex-1 min-h-0 pr-4">
            <div className="text-sm text-muted-foreground space-y-1.5 mb-4">
              {formatContent(content)}
            </div>

            {/* Validation Feedback */}
            <AnimatePresence>
              {validationError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{validationError}</span>
                </motion.div>
              )}
              
              {validationSuccess && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-cash/10 border border-cash/30 text-cash text-sm"
                >
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>{validationSuccess}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Interactive Hint */}
            {isInteractive && !validationSuccess && (
              <p className="text-xs text-primary mb-4 italic">
                ☝️ Complete the action above to continue
              </p>
            )}
          </ScrollArea>

          {/* Navigation - Always visible at bottom */}
          <div className="shrink-0 pt-2">
            <TutorialNavigation
              onNext={onNext}
              onBack={onBack}
              canGoNext={canGoNext}
              canGoBack={canGoBack}
              nextLabel={nextButtonLabel}
              isLastStep={isLastStep}
            />
          </div>
        </motion.div>
        
        {/* Spacer for top-right positioning */}
        {!isBottom && <div className="flex-1" />}
      </div>

      <ExitTutorialDialog
        open={showExitDialog}
        onOpenChange={setShowExitDialog}
        onConfirm={handleConfirmExit}
      />
    </>
  );
};
