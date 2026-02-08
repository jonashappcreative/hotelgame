import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TutorialNavigationProps {
  onNext: () => void;
  onBack: () => void;
  canGoNext: boolean;
  canGoBack: boolean;
  nextLabel?: string;
  isLastStep?: boolean;
}

export const TutorialNavigation: React.FC<TutorialNavigationProps> = ({
  onNext,
  onBack,
  canGoNext,
  canGoBack,
  nextLabel = 'Next',
  isLastStep = false,
}) => {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-border/50">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        disabled={!canGoBack}
        className="gap-1"
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </Button>
      
      <Button
        size="sm"
        onClick={onNext}
        disabled={!canGoNext}
        className="gap-1"
      >
        {nextLabel}
        {!isLastStep && <ChevronRight className="w-4 h-4" />}
      </Button>
    </div>
  );
};
