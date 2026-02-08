import React from 'react';
import { useTutorial } from './TutorialContext';
import { TutorialSpotlight } from './TutorialSpotlight';
import { TutorialTooltip } from './TutorialTooltip';
import { tutorialSteps } from './tutorialSteps';

export const TutorialOverlay: React.FC = () => {
  const {
    isActive,
    currentStep,
    totalSteps,
    validationError,
    validationSuccess,
    canGoNext,
    canGoBack,
    goToNextStep,
    goToPreviousStep,
    exitTutorial,
  } = useTutorial();

  if (!isActive) return null;

  const stepConfig = tutorialSteps.find(s => s.id === currentStep);
  if (!stepConfig) return null;

  // Determine tooltip position based on spotlight and interactive type
  const getTooltipPosition = (): 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' => {
    if (!stepConfig.spotlightSelector) {
      return 'center';
    }
    
    // For interactive steps that need the right sidebar (stock purchase, player info, etc.)
    // Position tooltip on the left to not block interaction
    if (stepConfig.interactiveType === 'buy_stock' || 
        stepConfig.interactiveType === 'stock_disposal' ||
        stepConfig.spotlightSelector?.includes('stock-purchase') ||
        stepConfig.spotlightSelector?.includes('player-info') ||
        stepConfig.spotlightSelector?.includes('player-stocks')) {
      return 'bottom-left';
    }
    
    // Check if spotlight is in the lower half of the screen
    const element = document.querySelector(stepConfig.spotlightSelector);
    if (element) {
      const rect = element.getBoundingClientRect();
      // If element is on the right side, put tooltip on left
      if (rect.left > window.innerWidth / 2) {
        return rect.top > window.innerHeight / 2 ? 'top-left' : 'bottom-left';
      }
      // If element is in the lower half, put tooltip at top
      if (rect.top > window.innerHeight / 2) {
        return 'top-right';
      }
    }
    return 'bottom-right';
  };

  return (
    <>
      <TutorialSpotlight
        targetSelector={stepConfig.spotlightSelector}
        shape={stepConfig.spotlightShape}
        isVisible={isActive}
      />
      
      <TutorialTooltip
        step={currentStep}
        totalSteps={totalSteps}
        title={stepConfig.title}
        content={stepConfig.content}
        onNext={goToNextStep}
        onBack={goToPreviousStep}
        onExit={exitTutorial}
        canGoBack={canGoBack}
        canGoNext={canGoNext}
        nextButtonLabel={stepConfig.nextButtonLabel}
        validationError={validationError}
        validationSuccess={validationSuccess}
        isInteractive={stepConfig.isInteractive}
        position={getTooltipPosition()}
      />
    </>
  );
};
