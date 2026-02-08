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

  // Determine tooltip position based on spotlight
  const getTooltipPosition = (): 'center' | 'bottom-right' | 'top-right' => {
    if (!stepConfig.spotlightSelector) {
      return 'center';
    }
    // Check if spotlight is in the lower half of the screen
    const element = document.querySelector(stepConfig.spotlightSelector);
    if (element) {
      const rect = element.getBoundingClientRect();
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
